package app.vaylo.spike

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Ответ API: HTTP-статус и разобранное тело. Ошибки сервера приходят как {"error":{"message","code"}}. */
class ApiResult(val status: Int, val body: JSONObject?) {
    val ok get() = status in 200..299
    val errorMessage: String
        get() = body?.optJSONObject("error")?.optString("message").orEmpty().ifEmpty { "Ошибка $status" }
    val errorCode: String? get() = body?.optJSONObject("error")?.optString("code")?.ifEmpty { null }
}

/**
 * Минимальный клиент к API VAYLO (база `<origin>/api/v1`), без зависимостей.
 * Токен хранится только в памяти и никогда не пишется в лог.
 */
class Api(private val origin: () -> String) {
    @Volatile var token: String? = null

    fun get(path: String): ApiResult = call("GET", path, null)
    fun post(path: String, body: JSONObject = JSONObject()): ApiResult = call("POST", path, body)

    private fun call(method: String, path: String, body: JSONObject?): ApiResult {
        val conn = (URL(origin().trimEnd('/') + "/api/v1" + path).openConnection() as HttpURLConnection)
        try {
            conn.requestMethod = method
            conn.connectTimeout = 10_000
            conn.readTimeout = 15_000
            conn.setRequestProperty("accept", "application/json")
            token?.let { conn.setRequestProperty("authorization", "Bearer $it") }
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("content-type", "application/json")
                conn.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = try { JSONObject(text) } catch (_: Exception) { null }
            return ApiResult(status, json)
        } finally {
            conn.disconnect()
        }
    }
}
