package app.vaylo.client

import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                vm.events.collect { e ->
                    when (e) {
                        is Event.OpenUrl -> if (!openUrl(e.url)) Toast.makeText(this@MainActivity, "Не удалось открыть ссылку. Установите Telegram или браузер.", Toast.LENGTH_LONG).show()
                        is Event.Toast -> Toast.makeText(this@MainActivity, e.text, Toast.LENGTH_LONG).show()
                    }
                }
            }
        }
        setContent { VaylTheme { Root(vm) } }
    }

    /** Вернулись из браузера, бота или клиента: обновляем данные (оплата, привязка, подписка) */
    override fun onResume() {
        super.onResume()
        vm.refresh()
    }
}

@Composable
fun Root(vm: AppViewModel) {
    val s by vm.ui.collectAsState()
    BackHandler(enabled = s.stack.size > 1) { vm.pop() }
    when (s.screen) {
        Screen.Login -> LoginScreen(vm, s)
        Screen.Register -> RegisterScreen(vm, s)
        Screen.Reset -> ResetScreen(vm, s)
        Screen.Main -> MainScreen(vm, s)
        Screen.Connect -> ConnectScreen(vm, s)
        Screen.Pay -> PayScreen(vm, s)
        Screen.ChangePassword -> ChangePasswordScreen(vm, s)
        Screen.AddCredentials -> AddCredentialsScreen(vm, s)
        Screen.LinkTelegram -> LinkTelegramScreen(vm, s)
    }
}
