# VAYLO Android

Нативное приложение-кабинет для клиентов VAYLO (Kotlin, Jetpack Compose). Только Android 7.0+ (API 24).
Что умеет: вход по почте и паролю или через Telegram, регистрация, сброс пароля через бота, привязка Telegram, статус подписки,
пробный период, тарифы и оплата, подключение в Happ / Hiddify / Incy / Karing. Дизайн: Orbit (тёмная) и Arctic (светлая) по системной теме.

Контракт API: [`docs/android/API.md`](../../docs/android/API.md). План: `.claude/PRPs/plans/vaylo-email-auth-server.plan.md`.

## Сборка
Нужны JDK 17+ и Android SDK (`platforms;android-34`, `build-tools;34.0.0`).
```bash
export ANDROID_HOME=/путь/к/android-sdk
cd apps/android
./gradlew testDebugUnitTest          # проверка разбора ответов сервера и форматирования
./gradlew assembleDebug              # отладочная сборка (debug-подпись)
./gradlew assembleRelease -Pvaylo.origin=https://app.example.com   # релиз, адрес сервера вшит
```
Без `-Pvaylo.origin` приложение при первом входе спросит адрес сервера.

## Подпись релиза
Создайте ключ один раз и **сохраните его в надёжном месте**: без него вы не сможете выпускать обновления, которые Android установит поверх прежней версии.
```bash
keytool -genkeypair -keystore vaylo-release.jks -alias vaylo -keyalg RSA -keysize 4096 -validity 36500
```
Затем создайте `apps/android/signing.properties` (в git не попадает):
```
storeFile=/путь/к/vaylo-release.jks
storePassword=...
keyAlias=vaylo
keyPassword=...
```
Ключ и пароль в репозиторий не коммитить.

## Распространение APK напрямую
- Страница загрузки на вашем сайте и контрольная сумма SHA-256 рядом с файлом.
- Пользователю нужно разрешить установку из этого источника; Play Protect может предупредить о неизвестном разработчике.
- Обновления: приложение само не обновляется. Новая версия ставится поверх старой, только если подписана тем же ключом и имеет больший `versionCode` (`app/build.gradle.kts`).

## Что известно о проверке
- Сборка, unit-тесты разбора ответов (на настоящих ответах API) и Android Lint проходят.
- На устройстве приложение пока не запускалось: вход, оплата и открытие VPN-клиентов проверены только по коду. Схемы `happ://add/` и `karing://install-config` официально не подтверждены (см. `docs/android/VALIDATION.md`).

## Ограничения этой версии
Нет: поддержки внутри приложения, пополнения баланса, рефералов, QR-кода подписки, уведомлений, списка устройств. Пробный период и шлюз канала требуют привязанного Telegram.
