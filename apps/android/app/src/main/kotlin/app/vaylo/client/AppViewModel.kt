package app.vaylo.client

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.UUID

sealed interface Screen {
    data object Login : Screen
    data object Register : Screen
    data object Reset : Screen
    data object Main : Screen
    data object Connect : Screen
    data object Pay : Screen
    data object ChangePassword : Screen
    data object AddCredentials : Screen
    data object LinkTelegram : Screen
}

enum class Tab { Home, Plans, Profile }
enum class ResetStep { Email, Waiting, NewPassword }
enum class PayPhase { Choose, Waiting, Done, Failed }

data class PayState(
    val plan: Plan, val methods: List<PayMethod>? = null, val selected: String? = null,
    val total: Long? = null, val discount: Long = 0, val phase: PayPhase = PayPhase.Choose,
    val message: String? = null, val key: String = UUID.randomUUID().toString(), val payUrl: String? = null,
)

data class UiState(
    val booting: Boolean = false,
    val stack: List<Screen> = listOf(Screen.Login),
    val tab: Tab = Tab.Home,
    val me: Me? = null,
    val plans: List<Plan>? = null,
    val busy: Boolean = false,
    val error: String? = null,
    val originRequired: Boolean = false,
    val waiting: Boolean = false, // ждём подтверждения в Telegram (вход, привязка)
    val resetStep: ResetStep = ResetStep.Email,
    val resetToken: String? = null,
    val pay: PayState? = null,
) {
    val screen get() = stack.last()
}

sealed interface Event {
    data class OpenUrl(val url: String) : Event
    data class Toast(val text: String) : Event
}

class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val store = TokenStore(app)
    private var token: String? = store.load()
    private var flow: Job? = null

    private val api = Api(origin = { originValue() }, token = { token }, onSessionLost = { sessionLost() })
    private val _ui = MutableStateFlow(
        UiState(
            stack = if (token == null) listOf(Screen.Login) else listOf(Screen.Main),
            booting = token != null,
            originRequired = BuildConfig.API_ORIGIN.isBlank() && store.origin.isBlank(),
        ),
    )
    val ui = _ui.asStateFlow()
    private val _events = MutableSharedFlow<Event>(extraBufferCapacity = 16)
    val events: SharedFlow<Event> = _events.asSharedFlow()

    init { if (token != null) viewModelScope.launch { refreshMe(initial = true) } }

    private fun originValue() = BuildConfig.API_ORIGIN.ifBlank { store.origin }
    val serverLocked get() = BuildConfig.API_ORIGIN.isNotBlank()
    val serverHost: String get() = originValue().removePrefix("https://")

    // ---------- навигация ----------

    fun push(s: Screen) = _ui.update { it.copy(stack = it.stack + s, error = null) }
    fun pop() {
        cancelFlow()
        _ui.update {
            if (it.stack.size > 1) it.copy(
                stack = it.stack.dropLast(1), error = null,
                pay = if (it.screen == Screen.Pay) null else it.pay,
                resetStep = if (it.screen == Screen.Reset) ResetStep.Email else it.resetStep,
                resetToken = if (it.screen == Screen.Reset) null else it.resetToken,
            ) else it
        }
    }
    fun selectTab(t: Tab) = _ui.update { it.copy(tab = t, error = null) }
    fun clearError() = _ui.update { it.copy(error = null) }
    fun toast(t: String) { _events.tryEmit(Event.Toast(t)) }

    // ---------- сессия ----------

    private fun setToken(t: String?) { token = t; store.save(t) }

    private fun loggedIn(accessToken: String) {
        cancelFlow()
        setToken(accessToken)
        _ui.update { it.copy(stack = listOf(Screen.Main), tab = Tab.Home, error = null, busy = true, waiting = false) }
        viewModelScope.launch { refreshMe() ; _ui.update { it.copy(busy = false) } }
    }

    fun logout() {
        cancelFlow()
        setToken(null)
        _ui.value = UiState(originRequired = _ui.value.originRequired && originValue().isBlank())
    }

    private fun sessionLost() {
        if (token == null) return
        cancelFlow()
        setToken(null)
        _ui.value = UiState(error = "Сессия завершена. Войдите снова.")
    }

    fun setOrigin(raw: String): Boolean {
        val v = raw.trim().trimEnd('/')
        if (!v.startsWith("https://") || v.length < 12 || v.contains(' ')) {
            _ui.update { it.copy(error = "Адрес сервера должен начинаться с https://") }
            return false
        }
        store.origin = v
        _ui.update { it.copy(originRequired = false, error = null) }
        return true
    }

    suspend fun refreshMe(initial: Boolean = false) {
        if (token == null) return
        try {
            val me = parseMe(api.obj("GET", "/me"))
            _ui.update { it.copy(me = me, booting = false) }
        } catch (e: ApiException) {
            if (initial) _ui.update { it.copy(booting = false, error = if (e.status == 0) e.message else it.error) }
            else if (e.status == 0) toast(e.message ?: "Нет соединения")
        }
    }

    fun refresh() { viewModelScope.launch { refreshMe() } }

    // ---------- вспомогательное ----------

    private fun cancelFlow() { flow?.cancel(); flow = null; _ui.update { it.copy(waiting = false) } }

    private fun fail(e: Throwable) {
        if (e is CancellationException) throw e
        val ex = e as? ApiException
        // шлюз канала или нужен Telegram: перечитываем профиль, экран «Привяжите Telegram» / «Подпишитесь» появится сам
        if (ex?.code == "telegram_required" || ex?.code == "subscribe_required") refresh()
        _ui.update { it.copy(error = ex?.message ?: "Что-то пошло не так. Попробуйте ещё раз.", busy = false) }
    }

    private fun launchBusy(block: suspend () -> Unit) {
        _ui.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try { block() } catch (e: Throwable) { fail(e) } finally { _ui.update { it.copy(busy = false) } }
        }
    }

    private suspend fun poll(everyMs: Long, forMs: Long, check: suspend () -> Boolean) {
        val until = System.currentTimeMillis() + forMs
        while (System.currentTimeMillis() < until) {
            delay(everyMs)
            val done = try { check() } catch (e: ApiException) { if (e.status == 0) false else throw e }
            if (done) return
        }
        throw ApiException(0, "timeout", "Время ожидания вышло. Попробуйте ещё раз.")
    }

    private fun creds(email: String, password: String) = JSONObject().put("email", email.trim()).put("password", password)

    // ---------- вход и регистрация ----------

    fun login(email: String, password: String) = launchBusy {
        loggedIn(api.obj("POST", "/auth/email/login", creds(email, password)).getString("accessToken"))
    }

    fun register(email: String, password: String) = launchBusy {
        loggedIn(api.obj("POST", "/auth/email/register", creds(email, password)).getString("accessToken"))
    }

    /** Вход через Telegram для тех, кто уже пользуется VAYLO в Telegram */
    fun telegramLogin() {
        cancelFlow()
        _ui.update { it.copy(busy = true, error = null, waiting = false) }
        flow = viewModelScope.launch {
            try {
                val s = api.obj("POST", "/auth/tglink/start", JSONObject())
                val url = s.optString("url").ifEmpty { null } ?: throw ApiException(0, "no_bot", "Вход через Telegram сейчас недоступен")
                _ui.update { it.copy(busy = false, waiting = true) }
                _events.tryEmit(Event.OpenUrl(url))
                var access: String? = null
                poll(2000, s.optLong("expiresInSec", 600) * 1000) {
                    val r = api.obj("GET", "/auth/tglink/${s.getString("token")}")
                    when (r.optString("status")) {
                        "ok" -> { access = r.getString("accessToken"); true }
                        "expired" -> throw ApiException(0, "expired", "Ссылка входа устарела. Попробуйте ещё раз.")
                        else -> false
                    }
                }
                loggedIn(access!!)
            } catch (e: Throwable) { _ui.update { it.copy(waiting = false) }; fail(e) }
        }
    }

    fun cancelWaiting() { cancelFlow(); _ui.update { it.copy(busy = false) } }

    // ---------- сброс пароля через бота ----------

    fun resetStart(email: String) {
        cancelFlow()
        _ui.update { it.copy(busy = true, error = null) }
        flow = viewModelScope.launch {
            try {
                val s = api.obj("POST", "/auth/email/reset/start", JSONObject().put("email", email.trim()))
                val url = s.optString("url").ifEmpty { null } ?: throw ApiException(0, "no_bot", "Сброс через Telegram сейчас недоступен")
                val tok = s.getString("token")
                _ui.update { it.copy(busy = false, resetStep = ResetStep.Waiting, resetToken = tok, waiting = true) }
                _events.tryEmit(Event.OpenUrl(url))
                poll(2000, s.optLong("expiresInSec", 600) * 1000) {
                    when (api.obj("GET", "/auth/email/reset/$tok").optString("status")) {
                        "ok" -> true
                        "expired" -> throw ApiException(0, "expired", "Ссылка сброса устарела. Начните заново.")
                        else -> false
                    }
                }
                _ui.update { it.copy(resetStep = ResetStep.NewPassword, waiting = false) }
            } catch (e: Throwable) { _ui.update { it.copy(resetStep = ResetStep.Email, waiting = false) }; fail(e) }
        }
    }

    fun resetComplete(password: String) = launchBusy {
        val tok = _ui.value.resetToken ?: throw ApiException(0, "expired", "Ссылка сброса устарела. Начните заново.")
        loggedIn(api.obj("POST", "/auth/email/reset/complete", JSONObject().put("token", tok).put("password", password)).getString("accessToken"))
        _ui.update { it.copy(resetStep = ResetStep.Email, resetToken = null) }
    }

    fun resetRestart() { cancelFlow(); _ui.update { it.copy(resetStep = ResetStep.Email, resetToken = null, error = null) } }

    // ---------- Telegram и пароль в профиле ----------

    fun linkTelegram() {
        cancelFlow()
        _ui.update { it.copy(busy = true, error = null) }
        flow = viewModelScope.launch {
            try {
                val s = api.obj("POST", "/me/telegram/link/start", JSONObject())
                val url = s.optString("url").ifEmpty { null } ?: throw ApiException(0, "no_bot", "Привязка Telegram сейчас недоступна")
                _ui.update { it.copy(busy = false, waiting = true) }
                _events.tryEmit(Event.OpenUrl(url))
                poll(2000, s.optLong("expiresInSec", 600) * 1000) {
                    when (api.obj("GET", "/me/telegram/link/${s.getString("token")}").optString("status")) {
                        "ok" -> true
                        "expired" -> throw ApiException(0, "expired", "Ссылка привязки устарела. Попробуйте ещё раз.")
                        else -> false
                    }
                }
                refreshMe()
                _ui.update { it.copy(waiting = false) }
                toast("Telegram привязан")
                if (_ui.value.screen == Screen.LinkTelegram) pop()
            } catch (e: Throwable) { _ui.update { it.copy(waiting = false) }; fail(e) }
        }
    }

    fun addCredentials(email: String, password: String) = launchBusy {
        api.obj("POST", "/me/credentials", creds(email, password))
        refreshMe()
        toast("Вход по почте включён")
        pop()
    }

    fun changePassword(current: String, next: String) = launchBusy {
        val r = api.obj("POST", "/me/password", JSONObject().put("currentPassword", current).put("newPassword", next))
        setToken(r.getString("accessToken"))
        refreshMe()
        toast("Пароль изменён")
        pop()
    }

    fun checkGate() = launchBusy {
        api.obj("POST", "/gate/check", JSONObject())
        refreshMe()
    }

    // ---------- подписка и оплата ----------

    fun startTrial() = launchBusy {
        api.obj("POST", "/subscription/trial", JSONObject())
        refreshMe()
        toast("Пробный период включён")
    }

    fun loadPlans() {
        if (_ui.value.plans != null) return
        viewModelScope.launch {
            try { _ui.update { it.copy(plans = parsePlans(api.arr("GET", "/plans"))) } } catch (e: Throwable) { fail(e) }
        }
    }

    fun openPay(plan: Plan) {
        _ui.update { it.copy(pay = PayState(plan), stack = it.stack + Screen.Pay, error = null) }
        viewModelScope.launch {
            try {
                val methods = parseMethods(api.arr("GET", "/payment-methods"))
                val q = api.obj("POST", "/quote", JSONObject().put("planId", plan.id))
                _ui.update { s -> s.copy(pay = s.pay?.copy(methods = methods, selected = methods.firstOrNull()?.id, total = q.optLong("total"), discount = q.optLong("discount"))) }
            } catch (e: Throwable) {
                fail(e)
                _ui.update { s -> s.copy(pay = s.pay?.copy(methods = emptyList())) }
            }
        }
    }

    fun selectMethod(id: String) = _ui.update { s -> s.copy(pay = s.pay?.copy(selected = id)) }

    fun pay() {
        val p = _ui.value.pay ?: return
        val method = p.selected ?: return
        cancelFlow()
        _ui.update { s -> s.copy(error = null, pay = s.pay?.copy(phase = PayPhase.Waiting, message = null)) }
        flow = viewModelScope.launch {
            try {
                // один и тот же Idempotency-Key на попытку: повторное нажатие не создаст второй платёж
                val r = api.obj("POST", "/payments", JSONObject().put("planId", p.plan.id).put("method", method), mapOf("Idempotency-Key" to p.key))
                val id = r.getString("id")
                val payUrl = r.optString("payUrl").ifEmpty { null }
                if (r.optString("status") == "pending" && payUrl != null) {
                    _ui.update { s -> s.copy(pay = s.pay?.copy(payUrl = payUrl)) }
                    _events.tryEmit(Event.OpenUrl(payUrl))
                }
                var finalStatus = r.optString("status")
                var fulfilled = false
                poll(3000, 30 * 60_000L) {
                    val st = api.obj("GET", "/payments/$id")
                    finalStatus = st.optString("status")
                    fulfilled = st.optBoolean("fulfilled")
                    when {
                        finalStatus == "pending" -> false
                        finalStatus == "succeeded" -> fulfilled || st.optBoolean("fulfillFailed")
                        else -> true
                    }
                }
                refreshMe()
                _ui.update { s -> s.copy(pay = s.pay?.copy(phase = if (finalStatus == "succeeded" && fulfilled) PayPhase.Done else PayPhase.Failed,
                    message = if (finalStatus == "succeeded" && !fulfilled) "Оплата прошла, но доступ ещё не выдан. Он появится в течение минуты; если нет, напишите в поддержку." else if (finalStatus != "succeeded") "Платёж не завершён." else null)) }
            } catch (e: Throwable) {
                if (e is CancellationException) throw e
                _ui.update { s -> s.copy(pay = s.pay?.copy(phase = PayPhase.Choose, message = null)) }
                fail(e)
            }
        }
    }

    /** Новая попытка после неудачи: новый ключ идемпотентности, иначе сервер вернёт прежний платёж */
    fun payRetry() { cancelFlow(); _ui.update { s -> s.copy(error = null, pay = s.pay?.copy(phase = PayPhase.Choose, message = null, payUrl = null, key = UUID.randomUUID().toString())) } }

    fun payDone() {
        cancelFlow()
        _ui.update { it.copy(stack = listOf(Screen.Main), tab = Tab.Home, pay = null) }
    }
}
