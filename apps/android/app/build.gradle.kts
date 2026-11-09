import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Адрес сервера VAYLO можно вшить в сборку: ./gradlew assembleRelease -Pvaylo.origin=https://app.example.com
// Если не задан, приложение при первом входе спросит адрес.
val apiOrigin = (findProperty("vaylo.origin") as String?)?.trim().orEmpty()

// Подпись релиза: signing.properties рядом с этим файлом (в git не попадает):
//   storeFile=/путь/к/vaylo-release.jks  storePassword=...  keyAlias=vaylo  keyPassword=...
val signingProps = Properties().apply {
    val f = rootProject.file("signing.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "app.vaylo.client"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.vaylo.client"
        minSdk = 24
        targetSdk = 34
        versionCode = 2
        versionName = "0.2.0"
        buildConfigField("String", "API_ORIGIN", "\"$apiOrigin\"")
    }

    signingConfigs {
        if (signingProps.containsKey("storeFile")) {
            create("release") {
                storeFile = file(signingProps.getProperty("storeFile"))
                storePassword = signingProps.getProperty("storePassword")
                keyAlias = signingProps.getProperty("keyAlias")
                keyPassword = signingProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // Без R8: сжатие нельзя проверить на устройстве в этой среде, а сбой из-за него хуже лишних мегабайт.
            isMinifyEnabled = false
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

dependencies {
    val bom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(bom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303") // настоящий org.json: в android.jar для JVM-тестов только заглушки
}
