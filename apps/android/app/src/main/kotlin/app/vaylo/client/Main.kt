package app.vaylo.client

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.ExitToApp
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun MainScreen(vm: AppViewModel, s: UiState) {
    val me = s.me
    VaScreen {
        when {
            me == null && s.booting -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = LocalVa.current.link) }
            me == null -> Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                Strong("Не удалось загрузить данные", size = 18)
                Spacer(Modifier.height(8.dp))
                Body(s.error ?: "Проверьте интернет и попробуйте ещё раз.", align = TextAlign.Center)
                Spacer(Modifier.height(16.dp))
                PrimaryButton("Повторить", vm::refresh)
                TextLink("Выйти", vm::logout)
            }
            me.gate?.blocked == true -> GateScreen(vm, s, me)
            else -> Column(Modifier.fillMaxSize()) {
                Box(Modifier.weight(1f)) {
                    when (s.tab) {
                        Tab.Home -> HomeTab(vm, s, me)
                        Tab.Plans -> PlansTab(vm, s)
                        Tab.Profile -> ProfileTab(vm, s, me)
                    }
                }
                TabBar(s.tab, vm::selectTab)
            }
        }
    }
}

@Composable
private fun StatCard(title: String, text: String, modifier: Modifier = Modifier) {
    VaCard(modifier) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Strong(title, size = 15)
            Body(text, size = 12)
        }
    }
}

@Composable
private fun HomeTab(vm: AppViewModel, s: UiState, me: Me) {
    val c = LocalVa.current
    val sub = me.subscription
    val (pillText, pillColor, pillBg) = when (sub.state) {
        "active" -> Triple("Подписка активна", c.success, c.successBg)
        "trial" -> Triple("Пробный период", c.success, c.successBg)
        "expiring" -> Triple("Скоро закончится", c.warning, c.warningBg)
        "expired" -> Triple("Подписка закончилась", c.danger, c.danger.copy(alpha = 0.12f))
        else -> Triple("Нет подписки", c.muted, c.surface2)
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Wordmark()
            Box(
                Modifier.size(40.dp).clip(CircleShape).border(1.dp, c.border, CircleShape).clickable(role = Role.Button) { vm.selectTab(Tab.Profile) },
                contentAlignment = Alignment.Center,
            ) { Text(me.title.first().uppercase(), color = c.text, fontWeight = FontWeight.ExtraBold, fontSize = 15.sp) }
        }
        OrbitHero(height = 104.dp)
        H1("Привет!")
        Pill(pillText, pillColor, pillBg)

        VaCard(onClick = { vm.selectTab(Tab.Plans) }) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Box(Modifier.size(52.dp).clip(RoundedCornerShape(14.dp)).background(c.surface2), contentAlignment = Alignment.Center) {
                    Icon(Icons.Default.DateRange, null, tint = c.link)
                }
                Column(Modifier.weight(1f)) {
                    if (sub.active) {
                        Text("${daysText(sub.daysLeft)} доступа", color = c.text, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.4).sp)
                        dateRu(sub.expiresAt)?.let { Body("до $it", size = 13) }
                    } else {
                        Text("Нет активного доступа", color = c.text, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.4).sp)
                        Body("Выберите тариф или попробуйте бесплатно", size = 13)
                    }
                }
                Icon(Icons.Default.KeyboardArrowRight, null, tint = c.muted)
            }
        }

        when {
            sub.active -> {
                PrimaryButton("Подключить устройство", { vm.push(Screen.Connect) })
                Body("Включите VPN в Happ, Incy или другом клиенте", size = 12, align = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            }
            me.trialAvailable -> {
                PrimaryButton("Попробовать бесплатно", vm::startTrial, loading = s.busy)
                OutlineButton("Выбрать тариф", { vm.selectTab(Tab.Plans) })
            }
            else -> PrimaryButton("Выбрать тариф", { vm.selectTab(Tab.Plans) })
        }
        ErrorText(s.error)

        if (me.tgId == null) {
            Notice(
                "Привяжите Telegram", "Он нужен для пробного периода и чтобы сбросить пароль, если вы его забудете.", tone = Tone.Warning,
                action = { OutlineButton("Привязать Telegram", { vm.push(Screen.LinkTelegram) }, icon = Icons.Default.Send) },
            )
        }

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            val limit = sub.trafficLimitBytes
            StatCard(if (limit == 0L) "Безлимит" else "${gb(sub.trafficUsedBytes)} из ${gb(limit)}", if (limit == 0L) "Обычные локации без ограничений" else "Трафик за период", Modifier.weight(1f))
            StatCard(if (sub.deviceLimit > 0) "До ${sub.deviceLimit}" else "—", "Устройств в подписке", Modifier.weight(1f))
        }
    }
}

private fun perMonth(p: Plan): Long? = if (p.durationDays >= 60) p.price * 30 / p.durationDays else null

@Composable
private fun PlansTab(vm: AppViewModel, s: UiState) {
    val c = LocalVa.current
    LaunchedEffect(Unit) { vm.loadPlans() }
    val plans = s.plans
    var selected by remember { mutableStateOf<String?>(null) }
    val chosen = plans?.firstOrNull { it.id == selected } ?: plans?.firstOrNull()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        H1("Тарифы")
        Body("Одна подписка для всех ваших устройств.")
        Spacer(Modifier.height(6.dp))
        when {
            plans == null -> Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = c.link) }
            plans.isEmpty() -> Notice("Тарифов пока нет", "Загляните позже или напишите в поддержку.")
            else -> {
                for (p in plans) {
                    val on = p.id == chosen?.id
                    VaCard(accent = if (on) c.link else null, fill = if (on) c.link.copy(alpha = 0.08f) else null, onClick = { selected = p.id }) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                            Box(Modifier.size(24.dp).clip(CircleShape).border(2.dp, if (on) c.link else c.muted, CircleShape), contentAlignment = Alignment.Center) {
                                if (on) Box(Modifier.size(12.dp).clip(CircleShape).background(c.link))
                            }
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text(p.name, color = c.text, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.5).sp)
                                val sub = perMonth(p)?.let { "${rub(it)} в месяц" } ?: p.description.ifEmpty { "${daysText(p.durationDays)} доступа" }
                                Body(sub, size = 13)
                                p.badge?.let { b -> Text(b, color = c.link, fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 4.dp).clip(RoundedCornerShape(6.dp)).background(c.link.copy(alpha = 0.14f)).padding(horizontal = 8.dp, vertical = 2.dp)) }
                            }
                            Column(horizontalAlignment = Alignment.End) {
                                Text(rub(p.price), color = c.text, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.7).sp)
                                p.oldPrice?.takeIf { it > p.price }?.let { Text(rub(it), color = c.muted, fontSize = 12.5.sp, textDecoration = TextDecoration.LineThrough) }
                            }
                        }
                    }
                }
                Spacer(Modifier.height(4.dp))
                PrimaryButton("Продолжить", { chosen?.let(vm::openPay) }, enabled = chosen != null)
                Body("Способ оплаты и итог на следующем шаге. Оплата откроется в браузере и вернёт вас в приложение.", size = 12, align = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                ErrorText(s.error)
            }
        }
    }
}

@Composable
private fun ProfileRow(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String, onClick: () -> Unit, tint: androidx.compose.ui.graphics.Color? = null) {
    val c = LocalVa.current
    VaCard(onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(icon, null, tint = tint ?: c.link)
            Text(text, Modifier.weight(1f), color = tint ?: c.text, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            Icon(Icons.Default.KeyboardArrowRight, null, tint = c.muted)
        }
    }
}

@Composable
private fun ProfileTab(vm: AppViewModel, s: UiState, me: Me) {
    val c = LocalVa.current
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        H1("Профиль")
        VaCard {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Box(Modifier.size(52.dp).clip(CircleShape).border(1.dp, c.border, CircleShape), contentAlignment = Alignment.Center) {
                    Text(me.title.first().uppercase(), color = c.text, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
                }
                Column {
                    Strong(me.title, size = 16)
                    Body(if (me.hasPassword) "Вход по почте и паролю" else "Вход через Telegram", size = 12)
                }
            }
        }
        if (me.tgId == null) {
            Notice(
                "Telegram не привязан", "Без него забытый пароль не восстановить: сброс идёт через бота. Ещё он нужен для пробного периода.", tone = Tone.Warning,
                action = { PrimaryButton("Привязать Telegram", { vm.push(Screen.LinkTelegram) }) },
            )
        } else {
            Notice("Telegram привязан", "Через него можно сбросить пароль и получать уведомления бота.", tone = Tone.Success)
        }
        Strong("Аккаунт", size = 16)
        if (me.hasPassword) ProfileRow(Icons.Default.Lock, "Сменить пароль", { vm.push(Screen.ChangePassword) })
        else ProfileRow(Icons.Default.Lock, "Добавить почту и пароль", { vm.push(Screen.AddCredentials) })
        ProfileRow(Icons.Default.Info, "Баланс: ${rub(me.balance)}", { vm.toast("Пополнение баланса появится в следующей версии") })
        Spacer(Modifier.height(4.dp))
        OutlineButton("Выйти", vm::logout, icon = Icons.Default.ExitToApp, tint = c.danger)
        Body("VAYLO ${BuildConfig.VERSION_NAME} · ${vm.serverHost}", size = 12, align = TextAlign.Center, modifier = Modifier.fillMaxWidth())
    }
}
