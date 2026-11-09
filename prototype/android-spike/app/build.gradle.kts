plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.vaylo.spike"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.vaylo.spike"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0-spike"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}
// Зависимостей нет намеренно: прототип использует только платформенные API Android.
