package app.vaylo.client

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp

@Composable
fun PayScreen(vm: AppViewModel, s: UiState) {
    val c = LocalVa.current
    val ctx = LocalContext.current
    val p = s.pay ?: return
    VaScreen {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (p.phase != PayPhase.Waiting && p.phase != PayPhase.Done) BackBar(vm::pop) else Box(Modifier.size(48.dp))
            H1("Оплата")
            VaCard {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Strong(p.plan.name, size = 18)
                        Body(if (p.discount > 0) "Скидка ${rub(p.discount)}" else "${daysText(p.plan.durationDays)} доступа", size = 13)
                    }
                    Strong(p.total?.let(::rub) ?: rub(p.plan.price), size = 22)
                }
            }
            when (p.phase) {
                PayPhase.Choose -> {
                    val methods = p.methods
                    when {
                        methods == null -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = c.link) }
                        methods.isEmpty() -> Notice("Способы оплаты не настроены", "Напишите в поддержку, мы поможем оформить подписку.", tone = Tone.Warning)
                        else -> {
                            Strong("Способ оплаты", size = 16)
                            for (m in methods) {
                                val on = m.id == p.selected
                                VaCard(accent = if (on) c.link else null, fill = if (on) c.link.copy(alpha = 0.08f) else null, onClick = { vm.selectMethod(m.id) }) {
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                                        Box(Modifier.size(24.dp).clip(CircleShape).border(2.dp, if (on) c.link else c.muted, CircleShape), contentAlignment = Alignment.Center) {
                                            if (on) Box(Modifier.size(12.dp).clip(CircleShape).background(c.link))
                                        }
                                        Strong(m.title, size = 15)
                                    }
                                }
                            }
                            ErrorText(s.error)
                            PrimaryButton("Оплатить ${p.total?.let(::rub) ?: rub(p.plan.price)}", vm::pay, enabled = p.selected != null && p.total != null)
                            Body("Оплата откроется в браузере. После неё вернитесь в приложение: статус обновится сам.", size = 12, align = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.fillMaxWidth())
                        }
                    }
                }
                PayPhase.Waiting -> {
                    Notice("Ждём оплату", "Завершите оплату в браузере и вернитесь в приложение. Не закрывайте приложение, пока не увидите результат.") {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = c.link, modifier = Modifier.size(28.dp)) }
                            p.payUrl?.let { u -> OutlineButton("Открыть страницу оплаты снова", { if (!ctx.openUrl(u)) vm.toast("Не удалось открыть браузер") }) }
                        }
                    }
                }
                PayPhase.Done -> {
                    Notice("Оплата прошла", "Подписка активна. Теперь можно подключить устройство.", tone = Tone.Success)
                    PrimaryButton("Готово", vm::payDone)
                }
                PayPhase.Failed -> {
                    Notice("Оплата не завершена", p.message ?: "Платёж не прошёл. Деньги не списаны или вернутся автоматически.", tone = Tone.Warning)
                    PrimaryButton("Выбрать способ заново", vm::payRetry)
                    OutlineButton("К тарифам", vm::payDone)
                }
            }
            if (p.phase == PayPhase.Done && p.message != null) ErrorText(p.message)
        }
    }
}
