package app.vaylo.client

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Ошибка API: status 0 — нет соединения. code — машинный код сервера (invalid_credentials, telegram_required, ...). */
class ApiException(val status: Int, val code: String?, message: String) : Exception(message)

/**
 * Клиент API VAYLO (база <origin>/api/v1) без сторонних библиотек.
 * Контракт: docs/android/API.md. Токен и ссылки подписки в лог не пишем.
 */
class Api(
    private val origin: () -> String,
    private val token: () -> String?,
    private val onSessionLost: () -> Unit,
) {
    suspend fun obj(method: String, path: String, body: JSONObject? = null, headers: Map<String, String> = emptyMap()): JSONObject =
        (call(method, path, body, headers) as? JSONObject) ?: JSONObject()

    suspend fun arr(method: String, path: String): JSONArray = (call(method, path, null, emptyMap()) as? JSONArray) ?: JSONArray()

    private suspend fun call(method: String, path: String, body: JSONObject?, headers: Map<String, String>): Any = withContext(Dispatchers.IO) {
        val base = origin().trim().trimEnd('/')
        if (!base.startsWith("https://")) throw ApiException(0, "no_origin", "Не указан адрес сервера")
        val conn = try {
            URL("$base/api/v1$path").openConnection() as HttpURLConnection
        } catch (e: IOException) {
            throw ApiException(0, "network", "Неверный адрес сервера")
        }
        try {
            conn.requestMethod = method
            conn.connectTimeout = 10_000
            conn.readTimeout = if (method == "GET") 12_000 else 25_000
            conn.setRequestProperty("accept", "application/json")
            val sentToken = token()
            if (sentToken != null) conn.setRequestProperty("authorization", "Bearer $sentToken")
            headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("content-type", "application/json")
                conn.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            val status = conn.responseCode
            val text = (if (status in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            val parsed: Any? = try { JSONTokener(text).nextValue() } catch (_: Exception) { null }
            if (status in 200..299) return@withContext parsed ?: JSONObject()
            val err = (parsed as? JSONObject)?.optJSONObject("error")
            val code = err?.optString("code")?.ifEmpty { null }
            // токен недействителен (истёк, сменили пароль): сообщаем приложению, чтобы вернуть на вход
            if (status == 401 && sentToken != null && code != "invalid_credentials") onSessionLost()
            throw ApiException(status, code, err?.optString("message")?.ifEmpty { null } ?: "Ошибка $status")
        } catch (e: IOException) {
            throw ApiException(0, "network", "Нет соединения с сервером. Проверьте интернет.")
        } finally {
            conn.disconnect()
        }
    }
}

/** JWT хранится в SharedPreferences зашифрованным ключом из Android Keystore (AES-GCM); ключ не покидает устройство. */
class TokenStore(context: Context) {
    private val prefs = context.getSharedPreferences("vaylo_secure", Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    fun save(token: String?) {
        if (token == null) { prefs.edit().remove("t").apply(); return }
        try {
            val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
            val packed = c.iv + c.doFinal(token.toByteArray())
            prefs.edit().putString("t", Base64.encodeToString(packed, Base64.NO_WRAP)).apply()
        } catch (_: Exception) {
            // хранилище ключей недоступно: токен просто не сохраняется, придётся входить заново
            prefs.edit().remove("t").apply()
        }
    }

    fun load(): String? {
        val s = prefs.getString("t", null) ?: return null
        return try {
            val raw = Base64.decode(s, Base64.NO_WRAP)
            val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw.copyOfRange(0, 12))) }
            String(c.doFinal(raw.copyOfRange(12, raw.size)))
        } catch (_: Exception) {
            prefs.edit().remove("t").apply()
            null
        }
    }

    var origin: String
        get() = prefs.getString("origin", "").orEmpty()
        set(v) { prefs.edit().putString("origin", v.trim()).apply() }

    private companion object { const val ALIAS = "vaylo_token_key" }
}

// ---------- модели ----------

class Subscription(
    val state: String, val planName: String?, val expiresAt: String?, val daysLeft: Int, val totalDays: Int,
    val trafficUsedBytes: Long, val trafficLimitBytes: Long, val deviceLimit: Int, val subUrl: String?, val isTrial: Boolean,
) {
    val active get() = state == "active" || state == "trial" || state == "expiring"
}

class GateChat(val title: String, val url: String, val joined: Boolean)
class Gate(val required: Boolean, val ok: Boolean, val text: String, val chats: List<GateChat>, val needTelegram: Boolean) {
    val blocked get() = required && !ok
}

class Me(
    val email: String?, val hasPassword: Boolean, val tgId: Long?, val username: String?, val firstName: String?,
    val balance: Long, val trialAvailable: Boolean, val subscription: Subscription, val gate: Gate?,
) {
    val title get() = email ?: firstName ?: username?.let { "@$it" } ?: "Аккаунт VAYLO"
}

class Plan(
    val id: String, val name: String, val description: String, val durationDays: Int, val trafficLimitGb: Int,
    val deviceLimit: Int, val price: Long, val oldPrice: Long?, val badge: String?,
)

class PayMethod(val id: String, val title: String)

private fun JSONObject.str(k: String): String? = if (isNull(k)) null else optString(k).ifEmpty { null }
private fun JSONObject.lng(k: String): Long? = if (isNull(k) || !has(k)) null else optLong(k)

fun parseSubscription(o: JSONObject?) = Subscription(
    state = o?.optString("state") ?: "none", planName = o?.str("planName"), expiresAt = o?.str("expiresAt"),
    daysLeft = o?.optInt("daysLeft") ?: 0, totalDays = o?.optInt("totalDays") ?: 0,
    trafficUsedBytes = o?.optLong("trafficUsedBytes") ?: 0, trafficLimitBytes = o?.optLong("trafficLimitBytes") ?: 0,
    deviceLimit = o?.optInt("deviceLimit") ?: 0, subUrl = o?.str("subUrl"), isTrial = o?.optBoolean("isTrial") ?: false,
)

fun parseMe(o: JSONObject): Me {
    val g = o.optJSONObject("gate")
    val gate = g?.let {
        val chats = it.optJSONArray("chats") ?: JSONArray()
        Gate(
            required = it.optBoolean("required"), ok = it.optBoolean("ok", true), text = it.optString("text"),
            chats = (0 until chats.length()).map { i -> chats.getJSONObject(i).let { c -> GateChat(c.optString("title"), c.optString("url"), c.optBoolean("joined")) } },
            needTelegram = it.optBoolean("needTelegram"),
        )
    }
    return Me(
        email = o.str("email"), hasPassword = o.optBoolean("hasPassword"), tgId = o.lng("tgId"), username = o.str("username"), firstName = o.str("firstName"),
        balance = o.optLong("balance"), trialAvailable = o.optBoolean("trialAvailable"), subscription = parseSubscription(o.optJSONObject("subscription")), gate = gate,
    )
}

fun parsePlans(a: JSONArray): List<Plan> = (0 until a.length()).map { i ->
    a.getJSONObject(i).let {
        Plan(it.optString("id"), it.optString("name"), it.optString("description"), it.optInt("durationDays"), it.optInt("trafficLimitGb"),
            it.optInt("deviceLimit"), it.optLong("price"), it.lng("oldPrice"), it.str("badge"))
    }
}

fun parseMethods(a: JSONArray): List<PayMethod> = (0 until a.length()).map { i -> a.getJSONObject(i).let { PayMethod(it.optString("id"), it.optString("title")) } }
