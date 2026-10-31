plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// release-please keeps the app version in version.txt.
val appVersion = rootProject.file("version.txt").readText().trim()
val (major, minor, patch) = appVersion.split(".").map(String::toInt)

// Point a build at another server with -Phomeoremedica.apiBaseUrl=http://10.0.2.2:8000
val apiBaseUrl = providers.gradleProperty("homeoremedica.apiBaseUrl")
    .orElse("https://homeoremedica-619837289655.asia-south1.run.app")
    .get()
    .trimEnd('/')

android {
    namespace = "io.github.rasagyavatsal.homeoremedica"
    compileSdk = 37

    defaultConfig {
        applicationId = "io.github.rasagyavatsal.homeoremedica"
        minSdk = 26
        targetSdk = 37
        versionCode = maxOf(1, major * 10_000 + minor * 100 + patch)
        versionName = appVersion
        buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.foundation)
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.okhttp)
    implementation(libs.commonmark)
    debugImplementation(libs.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
}
