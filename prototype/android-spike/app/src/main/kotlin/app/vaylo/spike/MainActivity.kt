package app.vaylo.spike

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Одноразовый прототип фазы 1 (см. .claude/PRPs/plans/vaylo-android-phase1-validation.plan.md).
 * Проверяет на устройстве: вход через бота, чтение подписки, передачу подписки в VPN-клиенты.
 * Это НЕ продуктовое приложение: нет навигации, оплаты, хранения токена и дизайна.
 */
class MainActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences("spike", MODE_PRIVATE) }
    private val api = Api { originField.text.toString().trim() }

    private lateinit var originField: EditText
    private lateinit var testUrlField: EditText
    private lateinit var notesField: EditText
    private lateinit var statusView: TextView
    private lateinit var logView: TextView
    private val installedViews = mutableListOf<Pair<Client, TextView>>()

    private val logBuf = StringBuilder()
    private val timeFmt = SimpleDateFormat("HH:mm:ss", Locale.US)
    @Volatile private var pollGen = 0
    private var lastLaunch: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())
        log("Запуск ${BuildInfo.line()}")
    }

    override fun onResume() {
        super.onResume()
        refreshInstalled()
        lastLaunch?.let { log("Вернулись в прототип после: $it"); lastLaunch = null }
    }

    // ---------- вход ----------

    private fun startLogin() {
        val origin = requireOrigin() ?: return
        pollGen++ // отменяем прежний опрос
        log("Вход: запрашиваем ссылку у ${hostOf(origin)}")
        bg {
            val r = try { api.post("/auth/tglink/start") } catch (e: Exception) {
                log("Вход: нет соединения (${e.javaClass.simpleName})"); return@bg
            }
            val b = r.body
            if (!r.ok || b == null) { log("Вход: ошибка ${r.status}: ${r.errorMessage}"); return@bg }
            val token = b.optString("token")
            val url = b.optString("url").ifEmpty { null }
            val ttl = b.optInt("expiresInSec", 600)
            if (token.isEmpty()) { log("Вход: сервер не вернул токен входа"); return@bg }
            if (url == null) { log("Вход: сервер не знает имя бота (BOT_USERNAME пуст), открыть Telegram нечем"); return@bg }
            main.post { openUrl(url, "Telegram (вход через бота)") }
            poll(token, ttl)
        }
    }

    private fun poll(token: String, ttlSec: Int) {
        val gen = ++pollGen
        log("Вход: ждём подтверждения в боте (до ${ttlSec / 60} мин)")
        bg {
            val deadline = System.currentTimeMillis() + ttlSec * 1000L
            while (gen == pollGen && System.currentTimeMillis() < deadline) {
                Thread.sleep(2000)
                if (gen != pollGen) return@bg
                val r = try { api.get("/auth/tglink/$token") } catch (e: Exception) { continue }
                if (!r.ok) { log("Вход: ошибка ${r.status}: ${r.errorMessage}"); return@bg }
                when (r.body?.optString("status")) {
                    "ok" -> {
                        api.token = r.body.optString("accessToken").ifEmpty { null }
                        log("Вход выполнен")
                        main.post { refreshProfile() }
                        return@bg
                    }
                    "expired" -> { log("Вход: ссылка истекла (токен входа живёт 10 минут и одноразовый)"); return@bg }
                }
            }
            if (gen == pollGen) log("Вход: время ожидания вышло")
        }
    }

    private fun cancelLogin() { pollGen++; log("Вход: ожидание отменено") }

    private fun logout() { pollGen++; api.token = null; statusView.text = "Не выполнен вход"; log("Выход: токен удалён из памяти") }

    // ---------- профиль и подписка ----------

    private fun refreshProfile() {
        if (api.token == null) { log("Профиль: сначала войдите"); return }
        bg {
            val r = try { api.get("/me") } catch (e: Exception) { log("Профиль: нет соединения (${e.javaClass.simpleName})"); return@bg }
            val b = r.body
            if (!r.ok || b == null) {
                if (r.status == 401) api.token = null
                log("Профиль: ошибка ${r.status}${r.errorCode?.let { " [$it]" } ?: ""}: ${r.errorMessage}")
                return@bg
            }
            val sub = b.optJSONObject("subscription")
            val subUrl = sub?.optString("subUrl").orEmpty()
            val gate = b.optJSONObject("gate")
            val text = buildString {
                append("Пользователь: ").append(b.optString("username").ifEmpty { b.optString("firstName") }.ifEmpty { "—" }).append('\n')
                append("Состояние: ").append(sub?.optString("state") ?: "—")
                sub?.optString("planName")?.takeIf { it.isNotEmpty() && it != "null" }?.let { append(" · ").append(it) }
                append('\n')
                append("Осталось дней: ").append(sub?.optInt("daysLeft") ?: 0).append('\n')
                val limit = sub?.optLong("trafficLimitBytes") ?: 0L
                append("Трафик: ").append(gb(sub?.optLong("trafficUsedBytes") ?: 0L)).append(" / ")
                    .append(if (limit == 0L) "безлимит" else gb(limit)).append('\n')
                append("Устройств: ").append(sub?.optInt("deviceLimit") ?: 0).append('\n')
                append("Ссылка подписки: ").append(if (subUrl.isEmpty()) "нет" else "есть (${subUrl.length} симв.)")
                if (gate != null && gate.optBoolean("required") && !gate.optBoolean("ok")) append("\n⚠ Требуется подписка на канал (gate)")
            }
            main.post {
                statusView.text = text
                if (subUrl.isNotEmpty()) testUrlField.setText(subUrl)
            }
            log("Профиль загружен: state=${sub?.optString("state")}, subUrl=${if (subUrl.isEmpty()) "нет" else "есть"}")
        }
    }

    // ---------- подключение ----------

    private fun launch(client: Client, v: Variant) {
        val sub = subUrl() ?: return
        openUrl(v.build(sub), "${client.name}: ${v.label}")
    }

    private fun openBridge(client: Client) {
        val origin = requireOrigin() ?: return
        val sub = subUrl() ?: return
        openUrl("${origin.trimEnd('/')}/import?client=${client.id}&url=${Uri.encode(sub)}", "${client.name}: страница-мост /import")
    }

    private fun openUrl(url: String, label: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            lastLaunch = label
            log("Открыто: $label → Intent отправлен (проверьте в клиенте, добавилась ли подписка)")
        } catch (e: ActivityNotFoundException) {
            log("Не открыто: $label → нет приложения, которое обрабатывает эту ссылку")
        } catch (e: Exception) {
            log("Не открыто: $label → ${e.javaClass.simpleName}")
        }
    }

    private fun copySubUrl() {
        val sub = subUrl() ?: return
        copy("Ссылка подписки", sub)
        log("Ссылка подписки скопирована в буфер (${sub.length} симв.)")
    }

    @Suppress("DEPRECATION")
    private fun isInstalled(scheme: String): Boolean =
        packageManager.resolveActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$scheme://x")), PackageManager.MATCH_DEFAULT_ONLY) != null

    private fun refreshInstalled() {
        for ((client, tv) in installedViews) {
            val ok = isInstalled(client.variants.first().scheme)
            tv.text = if (ok) "установлен" else "не найден"
            tv.setTextColor(if (ok) 0xFF2E7D32.toInt() else 0xFFC62828.toInt())
        }
    }

    // ---------- отчёт ----------

    private fun copyReport() {
        val report = buildString {
            appendLine("VAYLO Android spike — отчёт")
            appendLine(BuildInfo.line())
            appendLine("Сервер: ${hostOf(originField.text.toString().trim())}")
            appendLine("Клиенты на устройстве:")
            for (c in CLIENTS) appendLine("  ${c.name}: ${if (isInstalled(c.variants.first().scheme)) "установлен" else "не найден"}")
            appendLine("Заметки: ${notesField.text.toString().ifBlank { "—" }}")
            appendLine("--- журнал ---")
            append(logBuf)
        }
        copy("Отчёт", report)
        log("Отчёт скопирован в буфер обмена")
    }

    // ---------- вспомогательное ----------

    private fun requireOrigin(): String? {
        val o = originField.text.toString().trim()
        if (!o.startsWith("https://") || o.length < 12) {
            log("Укажите адрес сервера с https://, например https://app.example.com"); return null
        }
        prefs.edit().putString("origin", o).apply()
        return o
    }

    private fun subUrl(): String? {
        val u = testUrlField.text.toString().trim()
        if (!(u.startsWith("https://") || u.startsWith("http://"))) {
            log("Нет ссылки подписки: войдите или вставьте тестовую ссылку (http/https)"); return null
        }
        return u
    }

    private fun hostOf(url: String): String = try { Uri.parse(url).host ?: "—" } catch (_: Exception) { "—" }

    private fun gb(b: Long) = String.format(Locale.US, "%.2f ГБ", b / 1_073_741_824.0)

    private fun copy(label: String, text: String) {
        (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText(label, text))
    }

    private fun bg(block: () -> Unit) { Thread(block).apply { isDaemon = true }.start() }

    /** Потокобезопасно. В журнал нельзя писать токены и полные ссылки подписки. */
    private fun log(msg: String) {
        main.post {
            val line = "${timeFmt.format(Date())}  $msg"
            logBuf.appendLine(line)
            logView.text = logBuf.toString()
        }
    }

    // ---------- интерфейс (программно, без XML и библиотек) ----------

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun buildUi(): View {
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(16), dp(16), dp(32)) }
        fun title(t: String) = col.addView(TextView(this).apply { text = t; textSize = 17f; setTypeface(null, Typeface.BOLD); setPadding(0, dp(18), 0, dp(6)) })
        fun hint(t: String) = col.addView(TextView(this).apply { text = t; textSize = 12f; setTextColor(0xFF666666.toInt()) })
        fun btn(t: String, onClick: () -> Unit, parent: LinearLayout = col) = Button(this).apply {
            text = t; isAllCaps = false; setOnClickListener { onClick() }
        }.also { parent.addView(it, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)) }
        fun field(h: String, single: Boolean = true) = EditText(this).apply {
            hint = h; textSize = 14f; isSingleLine = single; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
        }.also { col.addView(it) }

        col.addView(TextView(this).apply { text = "VAYLO Android spike"; textSize = 22f; setTypeface(null, Typeface.BOLD) })
        hint("Одноразовый прототип для проверки входа и подключения. Не продуктовое приложение.")

        title("1. Сервер")
        originField = field("https://app.example.com")
        originField.setText(prefs.getString("origin", ""))
        hint("Адрес сайта VAYLO (тот же, что у Mini App). Только https.")

        title("2. Вход через бота")
        btn("Войти через Telegram", ::startLogin)
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        col.addView(row)
        fun half(t: String, f: () -> Unit) = Button(this).apply { text = t; isAllCaps = false; setOnClickListener { f() } }
            .also { row.addView(it, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)) }
        half("Отмена", ::cancelLogin); half("Обновить", ::refreshProfile); half("Выйти", ::logout)
        statusView = TextView(this).apply { text = "Не выполнен вход"; textSize = 14f; setPadding(0, dp(8), 0, 0) }
        col.addView(statusView)

        title("3. Ссылка подписки для проверки")
        testUrlField = field("подставится после входа или вставьте свою")
        hint("Можно проверить подключение без входа: вставьте любую ссылку подписки.")
        btn("Скопировать ссылку подписки", ::copySubUrl)

        title("4. Подключение в клиент")
        hint("«как в VAYLO» — схемы из apps/app/src/lib/clients.ts. Остальные варианты — для сравнения.")
        for (c in CLIENTS) {
            val head = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(10), 0, 0) }
            head.addView(TextView(this).apply { text = c.name; textSize = 16f; setTypeface(null, Typeface.BOLD) },
                LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            val st = TextView(this).apply { textSize = 13f }
            head.addView(st)
            col.addView(head)
            installedViews += c to st
            for (v in c.variants) btn(v.label, { launch(c, v) })
            btn("Страница-мост /import (запасной путь)", { openBridge(c) })
        }

        title("5. Результат")
        notesField = field("Заметки: что открылось, что добавилось", single = false)
        btn("Скопировать отчёт", ::copyReport)
        logView = TextView(this).apply { textSize = 11f; typeface = Typeface.MONOSPACE; setTextIsSelectable(true); setPadding(0, dp(8), 0, 0) }
        col.addView(logView)

        return ScrollView(this).apply { addView(col) }
    }
}

object BuildInfo {
    fun line() = "v0.1.0-spike · ${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})"
}
