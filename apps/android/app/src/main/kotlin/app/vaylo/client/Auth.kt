package app.vaylo.client

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Text

@Composable
private fun AuthColumn(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) { content() }
}

@Composable
fun Wordmark() = Text("VAYLO", color = LocalVa.current.text, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 3.6.sp)

@Composable
fun LoginScreen(vm: AppViewModel, s: UiState) {
    var email by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var origin by remember { mutableStateOf("") }
    var local by remember { mutableStateOf<String?>(null) }
    fun submit() {
        local = null
        if (s.originRequired && !vm.setOrigin(origin)) return
        if (!looksLikeEmail(email)) { local = "Введите почту полностью, например name@example.com"; return }
        if (pass.isEmpty()) { local = "Введите пароль"; return }
        vm.login(email, pass)
    }
    VaScreen {
        AuthColumn {
            Wordmark()
            OrbitHero()
            H1("Вход в кабинет")
            Body("Подписка, тарифы и подключение в одном приложении.")
            if (s.originRequired) Field("Адрес сервера VAYLO", origin, { origin = it }, placeholder = "https://app.example.com", keyboard = KeyboardType.Uri)
            Field("Почта", email, { email = it }, placeholder = "name@example.com", keyboard = KeyboardType.Email, enabled = !s.busy)
            Field("Пароль", pass, { pass = it }, placeholder = "Ваш пароль", password = true, enabled = !s.busy)
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) { TextLink("Забыли пароль? Сбросить через бота", { vm.push(Screen.Reset) }) }
            ErrorText(local ?: s.error)
            PrimaryButton("Войти", ::submit, loading = s.busy && !s.waiting)
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                HorizontalDivider(Modifier.weight(1f), color = LocalVa.current.border)
                Body("или", size = 12)
                HorizontalDivider(Modifier.weight(1f), color = LocalVa.current.border)
            }
            if (s.waiting) {
                Notice("Ждём подтверждения в Telegram", "Откройте бота и нажмите «Подтвердить вход». Приложение войдёт само.") {
                    OutlineButton("Отменить", vm::cancelWaiting)
                }
            } else {
                OutlineButton("Войти через Telegram", {
                    if (s.originRequired && !vm.setOrigin(origin)) return@OutlineButton
                    vm.telegramLogin()
                }, icon = Icons.Default.Send)
                Body("Для тех, кто уже пользуется VAYLO в Telegram", size = 12, align = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.fillMaxWidth())
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                Body("Нет аккаунта?")
                TextLink("Создать", { vm.push(Screen.Register) }, Modifier.padding(horizontal = 6.dp))
            }
        }
    }
}

@Composable
fun RegisterScreen(vm: AppViewModel, s: UiState) {
    var email by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var pass2 by remember { mutableStateOf("") }
    var origin by remember { mutableStateOf("") }
    var local by remember { mutableStateOf<String?>(null) }
    fun submit() {
        local = when {
            s.originRequired && !vm.setOrigin(origin) -> return
            !looksLikeEmail(email) -> "Введите почту полностью, например name@example.com"
            pass.length < 8 -> "Пароль не короче 8 символов"
            pass.lowercase() == email.trim().lowercase() -> "Пароль не должен совпадать с почтой"
            pass != pass2 -> "Пароли не совпадают"
            else -> null
        }
        if (local == null) vm.register(email, pass)
    }
    VaScreen {
        AuthColumn {
            BackBar(vm::pop)
            H1("Создать аккаунт")
            Body("Почта и пароль нужны только для входа в приложение. Письмо подтверждения не придёт.")
            if (s.originRequired) Field("Адрес сервера VAYLO", origin, { origin = it }, placeholder = "https://app.example.com", keyboard = KeyboardType.Uri)
            Field("Почта", email, { email = it }, placeholder = "name@example.com", keyboard = KeyboardType.Email, enabled = !s.busy)
            Field("Пароль", pass, { pass = it }, placeholder = "Не короче 8 символов", password = true, enabled = !s.busy)
            Field("Повторите пароль", pass2, { pass2 = it }, placeholder = "Ещё раз пароль", password = true, enabled = !s.busy)
            Notice("Пароль сбрасывается через Telegram", "Привяжите Telegram в профиле после регистрации, иначе забытый пароль не восстановить. Пробный период тоже доступен только с Telegram.")
            ErrorText(local ?: s.error)
            PrimaryButton("Создать аккаунт", ::submit, loading = s.busy)
            Body("Создавая аккаунт, вы принимаете условия сервиса", size = 12, align = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.fillMaxWidth())
        }
    }
}

@Composable
fun ResetScreen(vm: AppViewModel, s: UiState) {
    var email by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var pass2 by remember { mutableStateOf("") }
    var local by remember { mutableStateOf<String?>(null) }
    VaScreen {
        AuthColumn {
            BackBar(vm::pop)
            H1("Сброс пароля")
            when (s.resetStep) {
                ResetStep.Email -> {
                    Body("Писем мы не отправляем. Сброс подтверждается в Telegram-боте, нужен тот Telegram, который привязан к аккаунту.")
                    Field("Почта аккаунта", email, { email = it }, placeholder = "name@example.com", keyboard = KeyboardType.Email, enabled = !s.busy)
                    ErrorText(local ?: s.error)
                    PrimaryButton("Сбросить через Telegram", {
                        if (!looksLikeEmail(email)) local = "Введите почту полностью, например name@example.com" else { local = null; vm.resetStart(email) }
                    }, loading = s.busy)
                    Notice("Нет привязанного Telegram?", "Тогда пароль можно восстановить только через поддержку.", tone = Tone.Warning)
                }
                ResetStep.Waiting -> {
                    Notice("Подтвердите сброс в Telegram", "В боте нажмите «Подтвердить сброс». Пароль в чат присылать не нужно. Приложение продолжит само.") {
                        OutlineButton("Начать заново", vm::resetRestart)
                    }
                    ErrorText(s.error)
                }
                ResetStep.NewPassword -> {
                    Body("Telegram подтверждён. Задайте новый пароль.")
                    Field("Новый пароль", pass, { pass = it }, placeholder = "Не короче 8 символов", password = true, enabled = !s.busy)
                    Field("Повторите пароль", pass2, { pass2 = it }, placeholder = "Ещё раз пароль", password = true, enabled = !s.busy)
                    ErrorText(local ?: s.error)
                    PrimaryButton("Сохранить пароль", {
                        local = when {
                            pass.length < 8 -> "Пароль не короче 8 символов"
                            pass != pass2 -> "Пароли не совпадают"
                            else -> null
                        }
                        if (local == null) vm.resetComplete(pass)
                    }, loading = s.busy)
                }
            }
        }
    }
}
