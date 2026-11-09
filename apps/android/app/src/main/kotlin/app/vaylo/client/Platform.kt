package app.vaylo.client

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver

/** Открывает ссылку (https или схема VPN-клиента). false — нет приложения, которое её обрабатывает. */
fun Context.openUrl(url: String): Boolean = try {
    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    true
} catch (_: ActivityNotFoundException) {
    false
} catch (_: SecurityException) {
    false
}

fun Context.copyText(label: String, text: String) {
    (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText(label, text))
}

@Suppress("DEPRECATION")
fun Context.canHandle(scheme: String): Boolean =
    packageManager.resolveActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$scheme://x")), PackageManager.MATCH_DEFAULT_ONLY) != null

/** Меняется при каждом возврате в приложение (например, после установки клиента из магазина) */
@Composable
fun rememberResumeTick(): Int {
    val owner = LocalLifecycleOwner.current
    var tick by remember { mutableIntStateOf(0) }
    DisposableEffect(owner) {
        val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_RESUME) tick++ }
        owner.lifecycle.addObserver(obs)
        onDispose { owner.lifecycle.removeObserver(obs) }
    }
    return tick
}

/** VPN-клиенты. Схемы взяты из apps/app/src/lib/clients.ts; официально подтверждены hiddify и incy (docs/android/VALIDATION.md). */
class VpnClient(val id: String, val name: String, val scheme: String, val store: String, val deeplink: (String) -> String)

val VPN_CLIENTS = listOf(
    VpnClient("happ", "Happ", "happ", "https://play.google.com/store/apps/details?id=com.happproxy") { "happ://add/$it" },
    VpnClient("hiddify", "Hiddify", "hiddify", "https://play.google.com/store/apps/details?id=app.hiddify.com") { "hiddify://import/$it" },
    VpnClient("incy", "Incy", "incy", "https://play.google.com/store/apps/details?id=llc.itdev.incy") { "incy://import/$it" },
    VpnClient("karing", "Karing", "karing", "https://karing.app/download") { "karing://install-config?url=${Uri.encode(it)}&name=VAYLO" },
)
