package app.vaylo.client

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Send
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp

@Composable
private fun FormColumn(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) { content() }
}

@Composable
fun AddCredentialsScreen(vm: AppViewModel, s: UiState) {
    var email by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var pass2 by remember { mutableStateOf("") }
    var local by remember { mutableStateOf<String?>(null) }
    VaScreen {
        FormColumn {
            BackBar(vm::pop)
            H1("Вход по почте")
            Body("Добавьте почту и пароль, чтобы входить в приложение без Telegram. Ваша подписка и баланс сохранятся.")
            Field("Почта", email, { email = it }, placeholder = "name@example.com", keyboard = KeyboardType.Email, enabled = !s.busy)
            Field("Пароль", pass, { pass = it }, placeholder = "Не короче 8 символов", password = true, enabled = !s.busy)
            Field("Повторите пароль", pass2, { pass2 = it }, placeholder = "Ещё раз пароль", password = true, enabled = !s.busy)
            ErrorText(local ?: s.error)
            PrimaryButton("Сохранить", {
                local = when {
                    !looksLikeEmail(email) -> "Введите почту полностью, например name@example.com"
                    pass.length < 8 -> "Пароль не короче 8 символов"
                    pass.lowercase() == email.trim().lowercase() -> "Пароль не должен совпадать с почтой"
                    pass != pass2 -> "Пароли не совпадают"
                    else -> null
                }
                if (local == null) vm.addCredentials(email, pass)
            }, loading = s.busy)
        }
    }
}

@Composable
fun ChangePasswordScreen(vm: AppViewModel, s: UiState) {
    var cur by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var pass2 by remember { mutableStateOf("") }
    var local by remember { mutableStateOf<String?>(null) }
    VaScreen {
        FormColumn {
            BackBar(vm::pop)
            H1("Смена пароля")
            Body("После смены пароля на других устройствах нужно будет войти заново.")
            Field("Текущий пароль", cur, { cur = it }, password = true, enabled = !s.busy)
            Field("Новый пароль", pass, { pass = it }, placeholder = "Не короче 8 символов", password = true, enabled = !s.busy)
            Field("Повторите новый пароль", pass2, { pass2 = it }, password = true, enabled = !s.busy)
            ErrorText(local ?: s.error)
            PrimaryButton("Сменить пароль", {
                local = when {
                    cur.isEmpty() -> "Введите текущий пароль"
                    pass.length < 8 -> "Новый пароль не короче 8 символов"
                    pass != pass2 -> "Пароли не совпадают"
                    else -> null
                }
                if (local == null) vm.changePassword(cur, pass)
            }, loading = s.busy)
        }
    }
}

@Composable
fun LinkTelegramScreen(vm: AppViewModel, s: UiState) {
    VaScreen {
        FormColumn {
            BackBar(vm::pop)
            H1("Привязка Telegram")
            Body("Откроется бот. Нажмите «Привязать», и приложение продолжит само. С привязанным Telegram можно сбросить пароль и получить пробный период.")
            if (s.waiting) {
                Notice("Ждём подтверждения в Telegram", "Подтвердите привязку в боте и вернитесь сюда.") { OutlineButton("Отменить", vm::cancelWaiting) }
            } else {
                PrimaryButton("Открыть Telegram", vm::linkTelegram, loading = s.busy)
            }
            ErrorText(s.error)
            Notice("Telegram уже используется в VAYLO?", "Если этот Telegram уже привязан к другому аккаунту с подпиской, привязать его сюда нельзя. Тогда войдите через Telegram и добавьте почту в профиле.", tone = Tone.Warning)
        }
    }
}

/** Шлюз: нужна подписка на канал или привязанный Telegram */
@Composable
fun GateScreen(vm: AppViewModel, s: UiState, me: Me) {
    val g = me.gate ?: return
    val ctx = LocalContext.current
    FormColumn {
        Wordmark()
        OrbitHero()
        if (g.needTelegram) {
            H1("Привяжите Telegram")
            Body(g.text.ifBlank { "Чтобы продолжить, привяжите Telegram." })
            if (s.waiting) Notice("Ждём подтверждения в Telegram", "Подтвердите привязку в боте и вернитесь сюда.") { OutlineButton("Отменить", vm::cancelWaiting) }
            else PrimaryButton("Привязать Telegram", vm::linkTelegram, loading = s.busy)
        } else {
            H1("Подпишитесь на канал")
            Body(g.text.ifBlank { "Чтобы продолжить, подпишитесь на канал." })
            for (ch in g.chats.filter { !it.joined }) OutlineButton(ch.title.ifBlank { "Открыть канал" }, { if (!ctx.openUrl(ch.url)) vm.toast("Не удалось открыть ссылку") }, icon = Icons.Default.Send, enabled = ch.url.isNotBlank())
            PrimaryButton("Я подписался, проверить", vm::checkGate, loading = s.busy)
        }
        ErrorText(s.error)
        TextLink("Выйти из аккаунта", vm::logout)
    }
}
