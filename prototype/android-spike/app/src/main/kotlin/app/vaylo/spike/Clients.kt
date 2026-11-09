package app.vaylo.spike

import android.net.Uri

/** Один вариант deep link для проверки на устройстве. */
class Variant(val label: String, val scheme: String, val build: (String) -> String)

class Client(val id: String, val name: String, val variants: List<Variant>)

/**
 * Схемы взяты из apps/app/src/lib/clients.ts (то, что VAYLO использует сейчас),
 * плюс альтернативные варианты, которые надо сравнить на устройстве
 * (см. docs/android/VALIDATION.md: happ://add и karing:// официально не описаны).
 */
val CLIENTS: List<Client> = listOf(
    Client("happ", "Happ", listOf(
        Variant("happ://add/<url>  (как в VAYLO)", "happ") { "happ://add/$it" },
        Variant("happ://add/<url-encoded>", "happ") { "happ://add/" + Uri.encode(it) },
    )),
    Client("hiddify", "Hiddify", listOf(
        Variant("hiddify://import/<url>  (как в VAYLO)", "hiddify") { "hiddify://import/$it" },
        Variant("hiddify://import/<url>#VAYLO", "hiddify") { "hiddify://import/$it#VAYLO" },
    )),
    Client("incy", "Incy", listOf(
        Variant("incy://import/<url>  (как в VAYLO)", "incy") { "incy://import/$it" },
        Variant("incy://add/<url>", "incy") { "incy://add/$it" },
    )),
    Client("karing", "Karing", listOf(
        Variant("karing://install-config?url=…&name=VAYLO  (как в VAYLO)", "karing") {
            "karing://install-config?url=" + Uri.encode(it) + "&name=VAYLO"
        },
    )),
)
