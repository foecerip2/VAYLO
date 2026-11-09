package app.vaylo.client

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
private fun StepBadge(n: Int?, done: Boolean = false) {
    val c = LocalVa.current
    Box(
        Modifier.size(34.dp).clip(RoundedCornerShape(12.dp)).background(if (done) c.successBg else c.link.copy(alpha = 0.16f)),
        contentAlignment = Alignment.Center,
    ) {
        if (done) Icon(Icons.Default.Check, null, tint = c.success, modifier = Modifier.size(18.dp))
        else Text("$n", color = c.link, fontWeight = FontWeight.ExtraBold, fontSize = 15.sp)
    }
}

@Composable
fun ConnectScreen(vm: AppViewModel, s: UiState) {
    val c = LocalVa.current
    val ctx = LocalContext.current
    val tick = rememberResumeTick()
    val sub = s.me?.subscription
    var clientId by remember { mutableStateOf(VPN_CLIENTS.first().id) }
    val client = VPN_CLIENTS.first { it.id == clientId }
    val installed = remember(tick, clientId) { ctx.canHandle(client.scheme) }
    val url = sub?.subUrl

    VaScreen {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            BackBar(vm::pop)
            H1("Подключение")
            Body("Три шага, и VPN работает. Приложение само передаст подписку в клиент.")
            if (url == null || sub.active.not()) {
                Notice("Сначала оформите подписку", "После активации здесь появится кнопка подключения.", tone = Tone.Warning) {
                    PrimaryButton("Выбрать тариф", { vm.pop(); vm.selectTab(Tab.Plans) })
                }
                return@Column
            }
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (v in VPN_CLIENTS) {
                    val on = v.id == clientId
                    Text(
                        v.name,
                        Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(14.dp)).background(if (on) c.link.copy(alpha = 0.16f) else androidx.compose.ui.graphics.Color.Transparent)
                            .border(1.dp, if (on) c.link else c.border, RoundedCornerShape(14.dp)).clickable(role = Role.Tab) { clientId = v.id }.padding(horizontal = 16.dp, vertical = 12.dp),
                        color = if (on) c.link else c.text, fontWeight = if (on) FontWeight.Bold else FontWeight.SemiBold, fontSize = 14.sp,
                    )
                }
            }

            VaCard {
                Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        StepBadge(1, done = installed)
                        Column(Modifier.weight(1f)) {
                            Strong(if (installed) "Клиент установлен" else "Установите ${client.name}", size = 15)
                            Body(if (installed) "${client.name} найден на этом устройстве" else "Без него подписку открыть не получится", size = 12)
                        }
                    }
                    if (!installed) OutlineButton("Скачать ${client.name}", { if (!ctx.openUrl(client.store)) vm.toast("Не удалось открыть магазин") })
                }
            }

            VaCard(accent = c.link.copy(alpha = 0.5f), fill = c.link.copy(alpha = 0.07f)) {
                Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        StepBadge(2)
                        Column {
                            Strong("Добавьте подписку", size = 15)
                            Body("Откроется ${client.name}. Подтвердите добавление в нём.", size = 12)
                        }
                    }
                    PrimaryButton("Открыть в ${client.name}", {
                        if (!ctx.openUrl(client.deeplink(url))) vm.toast("${client.name} не открылся. Скопируйте ссылку ниже.")
                    }, enabled = installed)
                }
            }

            VaCard {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    StepBadge(3)
                    Column {
                        Strong("Включите VPN", size = 15)
                        Body("Обновите подписку, выберите сервер и нажмите кнопку подключения.", size = 12)
                    }
                }
            }

            VaCard {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Strong("Не открылось?", size = 14)
                    Body("Скопируйте ссылку и добавьте её в клиент вручную: «Добавить подписку» → «Из буфера». Ссылка личная, не публикуйте её.", size = 12)
                    OutlineButton("Скопировать ссылку", { ctx.copyText("Ссылка подписки VAYLO", url); vm.toast("Ссылка скопирована") }, icon = Icons.Default.Share)
                }
            }
        }
    }
}
