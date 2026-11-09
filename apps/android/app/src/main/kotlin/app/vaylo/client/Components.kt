package app.vaylo.client

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val Ctl = RoundedCornerShape(14.dp)
private val CardShape = RoundedCornerShape(18.dp)

@Composable
fun H1(text: String, modifier: Modifier = Modifier) =
    Text(text, modifier, color = LocalVa.current.text, fontSize = 32.sp, lineHeight = 35.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-1.1).sp)

@Composable
fun Body(text: String, modifier: Modifier = Modifier, muted: Boolean = true, size: Int = 14, align: TextAlign? = null, color: Color? = null) =
    Text(text, modifier, color = color ?: if (muted) LocalVa.current.muted else LocalVa.current.text, fontSize = size.sp, lineHeight = (size * 1.45f).sp, textAlign = align)

@Composable
fun Strong(text: String, modifier: Modifier = Modifier, size: Int = 15, color: Color? = null) =
    Text(text, modifier, color = color ?: LocalVa.current.text, fontSize = size.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.2).sp)

@Composable
fun VaCard(modifier: Modifier = Modifier, accent: Color? = null, fill: Color? = null, onClick: (() -> Unit)? = null, content: @Composable () -> Unit) {
    val c = LocalVa.current
    val base = modifier
        .fillMaxWidth()
        .clip(CardShape)
        .background(fill ?: c.surface)
        .border(BorderStroke(if (accent != null) 1.5.dp else 1.dp, accent ?: c.border), CardShape)
        .let { if (onClick != null) it.clickable(role = Role.Button, onClick = onClick) else it }
    Box(base.padding(14.dp)) { content() }
}

@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, loading: Boolean = false) {
    val c = LocalVa.current
    Box(
        modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clip(Ctl)
            .background(if (enabled) c.button else c.button.copy(alpha = 0.45f))
            .clickable(enabled = enabled && !loading, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (loading) CircularProgressIndicator(Modifier.size(22.dp), color = c.onButton, strokeWidth = 2.5.dp)
        else Text(text, color = c.onButton, fontSize = 16.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.2).sp)
    }
}

@Composable
fun OutlineButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null, enabled: Boolean = true, tint: Color? = null) {
    val c = LocalVa.current
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .clip(Ctl)
            .border(BorderStroke(1.dp, c.border), Ctl)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) { Icon(icon, null, Modifier.size(20.dp), tint = tint ?: c.text); Spacer(Modifier.width(10.dp)) }
        Text(text, color = tint ?: c.text, fontSize = 15.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun TextLink(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Text(text, modifier.heightIn(min = 44.dp).clickable(role = Role.Button, onClick = onClick).padding(vertical = 12.dp), color = LocalVa.current.link, fontSize = 14.sp, fontWeight = FontWeight.Bold)
}

@Composable
fun Field(
    label: String, value: String, onChange: (String) -> Unit, modifier: Modifier = Modifier,
    placeholder: String = "", password: Boolean = false, keyboard: KeyboardType = KeyboardType.Text, enabled: Boolean = true,
) {
    val c = LocalVa.current
    var shown by remember { mutableStateOf(false) }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, color = c.muted, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        OutlinedTextField(
            value = value, onValueChange = onChange, enabled = enabled, singleLine = true,
            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
            placeholder = { Text(placeholder, color = c.muted.copy(alpha = 0.8f)) },
            shape = Ctl,
            keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else keyboard),
            visualTransformation = if (password && !shown) PasswordVisualTransformation() else VisualTransformation.None,
            trailingIcon = if (password) { { Text(if (shown) "Скрыть" else "Показать", Modifier.clickable(role = Role.Button) { shown = !shown }.padding(12.dp), color = c.link, fontSize = 13.sp, fontWeight = FontWeight.Bold) } } else null,
            colors = OutlinedTextFieldDefaults.colors(
                focusedTextColor = c.text, unfocusedTextColor = c.text, disabledTextColor = c.muted,
                focusedContainerColor = c.surface, unfocusedContainerColor = c.surface, disabledContainerColor = c.surface,
                focusedBorderColor = c.link, unfocusedBorderColor = c.border, cursorColor = c.link,
            ),
        )
    }
}

@Composable
fun ErrorText(text: String?, modifier: Modifier = Modifier) {
    if (text.isNullOrBlank()) return
    Text(text, modifier.fillMaxWidth().semantics { contentDescription = "Ошибка: $text" }, color = LocalVa.current.danger, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold)
}

enum class Tone { Info, Warning, Success }

@Composable
fun Notice(title: String, text: String, modifier: Modifier = Modifier, tone: Tone = Tone.Info, action: (@Composable () -> Unit)? = null) {
    val c = LocalVa.current
    val (accent, fill) = when (tone) {
        Tone.Warning -> c.warning.copy(alpha = 0.4f) to c.warningBg
        Tone.Success -> c.success.copy(alpha = 0.4f) to c.successBg
        Tone.Info -> c.link.copy(alpha = 0.3f) to c.link.copy(alpha = 0.08f)
    }
    Column(
        modifier.fillMaxWidth().clip(CardShape).background(fill).border(BorderStroke(1.dp, accent), CardShape).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Strong(title, size = 14)
        Body(text, size = 13)
        if (action != null) { Spacer(Modifier.height(8.dp)); action() }
    }
}

@Composable
fun Pill(text: String, color: Color, bg: Color) {
    Row(Modifier.clip(CircleShape).background(bg).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(7.dp).clip(CircleShape).background(color))
        Spacer(Modifier.width(8.dp))
        Text(text, color = color, fontSize = 13.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun BackBar(onBack: () -> Unit) {
    Box(
        Modifier.size(48.dp).clip(RoundedCornerShape(14.dp)).clickable(role = Role.Button, onClick = onBack).semantics { contentDescription = "Назад" },
        contentAlignment = Alignment.Center,
    ) { Icon(Icons.Default.ArrowBack, null, tint = LocalVa.current.text) }
}

/** Орбиты VAYLO: логотип-иллюстрация, рисуется на Canvas */
@Composable
fun OrbitHero(modifier: Modifier = Modifier, height: Dp = 120.dp) {
    val c = LocalVa.current
    Canvas(modifier.fillMaxWidth().height(height).semantics { contentDescription = "" }) {
        val cx = size.width / 2f
        val cy = size.height / 2f
        val rx = size.height * 0.78f
        val ry = size.height * 0.26f
        val brush = Brush.linearGradient(listOf(c.orbitA, c.orbitB), start = Offset(cx - rx, cy - ry), end = Offset(cx + rx, cy + ry))
        val stroke = Stroke(width = 3.dp.toPx(), cap = StrokeCap.Round)
        rotate(-24f, Offset(cx, cy)) { drawOval(brush, Offset(cx - rx, cy - ry), Size(rx * 2, ry * 2), style = stroke) }
        rotate(24f, Offset(cx, cy)) { drawOval(brush, Offset(cx - rx, cy - ry), Size(rx * 2, ry * 2), alpha = 0.75f, style = stroke) }
        drawCircle(brush, radius = ry * 1.9f, center = Offset(cx, cy), alpha = 0.4f, style = Stroke(width = 2.dp.toPx()))
        drawCircle(c.dot, radius = 5.dp.toPx(), center = Offset(cx + rx * 0.72f, cy - ry * 1.1f))
        drawCircle(c.orbitA, radius = 3.dp.toPx(), center = Offset(cx - rx * 0.6f, cy + ry * 1.2f))
    }
}

@Composable
fun TabBar(current: Tab, onSelect: (Tab) -> Unit, modifier: Modifier = Modifier) {
    val c = LocalVa.current
    val items = listOf(Triple(Tab.Home, "Главная", Icons.Default.Home), Triple(Tab.Plans, "Тарифы", Icons.Default.ShoppingCart), Triple(Tab.Profile, "Профиль", Icons.Default.Person))
    Row(
        modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp).clip(RoundedCornerShape(22.dp)).background(c.surface)
            .border(BorderStroke(1.dp, c.border), RoundedCornerShape(22.dp)).padding(6.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        for ((tab, label, icon) in items) {
            val on = tab == current
            Column(
                Modifier.weight(1f).heightIn(min = 52.dp).clip(RoundedCornerShape(16.dp)).background(if (on) c.link.copy(alpha = 0.14f) else Color.Transparent)
                    .clickable(role = Role.Tab) { onSelect(tab) }.padding(vertical = 6.dp),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
            ) {
                Icon(icon, null, Modifier.size(22.dp), tint = if (on) c.link else c.muted)
                Text(label, color = if (on) c.text else c.muted, fontSize = 11.sp, fontWeight = if (on) FontWeight.Bold else FontWeight.SemiBold)
            }
        }
    }
}

/** Фон экрана с мягким свечением сверху; содержимое не заходит под системные панели и клавиатуру */
@Composable
fun VaScreen(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val c = LocalVa.current
    Box(modifier.fillMaxSize().background(c.bg).background(Brush.verticalGradient(listOf(c.glow, Color.Transparent), endY = 700f))) {
        Box(Modifier.fillMaxSize().systemBarsPadding().imePadding()) { content() }
    }
}
