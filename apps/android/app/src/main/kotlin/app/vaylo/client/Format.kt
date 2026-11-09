package app.vaylo.client

import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/** Рубли из копеек: 149900 → «1 499 ₽» */
fun rub(kop: Long): String {
    val r = kop / 100
    val s = r.toString().reversed().chunked(3).joinToString(" ").reversed()
    return if (kop % 100 == 0L) "$s\u00A0₽" else "$s,${(kop % 100).toString().padStart(2, '0')}\u00A0₽"
}

fun plural(n: Int, one: String, few: String, many: String): String {
    val m10 = n % 10
    val m100 = n % 100
    return when {
        m10 == 1 && m100 != 11 -> one
        m10 in 2..4 && m100 !in 12..14 -> few
        else -> many
    }
}

fun daysText(n: Int) = "$n ${plural(n, "день", "дня", "дней")}"

/** ISO-дата сервера → «23 ноября» */
fun dateRu(iso: String?): String? {
    if (iso.isNullOrBlank()) return null
    val patterns = listOf("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'")
    for (p in patterns) {
        try {
            val f = SimpleDateFormat(p, Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
            val d = f.parse(iso) ?: continue
            if (d.time > 4_000_000_000_000L) return null // «бессрочно» (2099)
            return SimpleDateFormat("d MMMM", Locale("ru")).format(d)
        } catch (_: Exception) { /* следующий формат */ }
    }
    return null
}

fun gb(bytes: Long): String = String.format(Locale("ru"), "%.1f ГБ", bytes / 1_073_741_824.0)

fun looksLikeEmail(s: String) = s.trim().let { it.length <= 254 && Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]{2,}$").matches(it) }
