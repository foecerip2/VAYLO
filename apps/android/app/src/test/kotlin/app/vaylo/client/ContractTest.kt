package app.vaylo.client

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Разбор настоящих ответов сервера. Файлы в src/test/resources сняты с запущенного API (apps/api, тестовый стенд),
 * поэтому тест ловит расхождение имён и типов полей между сервером и приложением.
 */
class ContractTest {
    private fun res(name: String) = javaClass.classLoader!!.getResource(name)!!.readText()

    @Test fun `профиль аккаунта по почте`() {
        val me = parseMe(JSONObject(res("me_email.json")))
        assertEquals("fx@example.com", me.email)
        assertTrue(me.hasPassword)
        assertNull(me.tgId)
        assertFalse(me.trialAvailable)
        assertEquals("none", me.subscription.state)
        assertNull(me.subscription.subUrl)
        assertNull(me.subscription.planName)
        assertFalse(me.subscription.active)
        assertFalse(me.gate!!.blocked)
        assertEquals("fx@example.com", me.title)
    }

    @Test fun `профиль Telegram-клиента без пароля`() {
        val me = parseMe(JSONObject(res("me_telegram.json")))
        assertEquals(5550001L, me.tgId)
        assertFalse(me.hasPassword)
        assertNull(me.email)
        assertEquals("Сергей", me.title)
        assertTrue(me.trialAvailable)
    }

    @Test fun `шлюз просит привязать Telegram`() {
        val me = parseMe(JSONObject(res("me_gate_blocked.json")))
        val g = me.gate!!
        assertTrue(g.blocked)
        assertTrue(g.needTelegram)
        assertTrue(g.chats.isEmpty())
        assertTrue(g.text.contains("Telegram"))
    }

    @Test fun `тарифы`() {
        val plans = parsePlans(JSONArray(res("plans.json")))
        assertEquals(2, plans.size)
        val half = plans.first { it.durationDays == 180 }
        assertEquals(89900L, half.price)
        assertEquals(119400L, half.oldPrice)
        assertEquals("Хит", half.badge)
        val month = plans.first { it.durationDays == 30 }
        assertNull(month.oldPrice)
        assertNull(month.badge)
        assertEquals("Базовый доступ", month.description)
    }

    @Test fun `ответы входа и форма ошибок`() {
        assertTrue(JSONObject(res("login_ok.json")).getString("accessToken").split(".").size == 3)
        val err = JSONObject(res("error_login.json")).getJSONObject("error")
        assertEquals("invalid_credentials", err.getString("code"))
        assertEquals("telegram_required", JSONObject(res("error_telegram_required.json")).getJSONObject("error").getString("code"))
    }

    @Test fun `рубли и дни`() {
        assertEquals("199 ₽", rub(19900))
        assertEquals("1 499 ₽", rub(149900))
        assertEquals("89 900 ₽".replace("89 900", "899"), rub(89900))
        assertEquals("1 день", daysText(1))
        assertEquals("2 дня", daysText(2))
        assertEquals("5 дней", daysText(5))
        assertEquals("11 дней", daysText(11))
        assertEquals("21 день", daysText(21))
        assertEquals("23 дня", daysText(23))
    }

    @Test fun `почта и даты`() {
        assertTrue(looksLikeEmail(" name@example.com "))
        assertFalse(looksLikeEmail("name@"))
        assertFalse(looksLikeEmail("name example.com"))
        assertEquals("23 ноября", dateRu("2026-11-23T10:00:00.000Z"))
        assertNull(dateRu("2099-12-31T00:00:00.000Z"))
        assertNull(dateRu(null))
    }
}
