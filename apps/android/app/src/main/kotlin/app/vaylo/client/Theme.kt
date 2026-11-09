package app.vaylo.client

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/** Цвета VAYLO: тёмная тема Orbit и светлая Arctic (docs/design/VAYLO-DESIGN-SYSTEM.md, apps/app Design v2). */
class VaColors(
    val dark: Boolean,
    val bg: Color, val surface: Color, val surface2: Color, val border: Color,
    val text: Color, val muted: Color,
    val link: Color, val button: Color, val onButton: Color,
    val success: Color, val successBg: Color, val warning: Color, val warningBg: Color, val danger: Color,
    val glow: Color, val orbitA: Color, val orbitB: Color, val dot: Color,
)

val OrbitDark = VaColors(
    dark = true, bg = Color(0xFF09090F), surface = Color(0xFF13131D), surface2 = Color(0xFF1D1D2A), border = Color(0xFF2A2938),
    text = Color(0xFFF5F4FA), muted = Color(0xFFA9A8BC),
    link = Color(0xFFA58BFF), button = Color(0xFF683DF4), onButton = Color.White,
    success = Color(0xFF6EE7B7), successBg = Color(0x1F6EE7B7), warning = Color(0xFFFFB26D), warningBg = Color(0x14FFB26D), danger = Color(0xFFFF8A8F),
    glow = Color(0x3D916AFF), orbitA = Color(0xFFB79BFF), orbitB = Color(0xFF683DF4), dot = Color(0xFFFFB26D),
)

val ArcticLight = VaColors(
    dark = false, bg = Color(0xFFF6F7FB), surface = Color(0xFFFFFFFF), surface2 = Color(0xFFE6ECF9), border = Color(0xFFE2E5EE),
    text = Color(0xFF0E1120), muted = Color(0xFF5B6278),
    link = Color(0xFF2459C4), button = Color(0xFF2459C4), onButton = Color.White,
    success = Color(0xFF0B6B43), successBg = Color(0xFFDDF3E8), warning = Color(0xFF9A4B00), warningBg = Color(0xFFFFF1DE), danger = Color(0xFFC0262D),
    glow = Color(0x1A2459C4), orbitA = Color(0xFF7FA2F5), orbitB = Color(0xFF2459C4), dot = Color(0xFFF79009),
)

val LocalVa = staticCompositionLocalOf { OrbitDark }

@Composable
fun VaylTheme(content: @Composable () -> Unit) {
    val c = if (isSystemInDarkTheme()) OrbitDark else ArcticLight
    val scheme = if (c.dark) darkColorScheme(primary = c.button, background = c.bg, surface = c.surface, onSurface = c.text, onBackground = c.text)
    else lightColorScheme(primary = c.button, background = c.bg, surface = c.surface, onSurface = c.text, onBackground = c.text)
    CompositionLocalProvider(LocalVa provides c) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}
