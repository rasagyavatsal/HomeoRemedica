import com.github.triplet.gradle.androidpublisher.ResolutionStrategy
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.play.publisher)
}

// Accounts use the Firebase project in app/google-services.json; builds without it keep chats on the
// device only, as the web app does when the server has no accounts.
if (file("google-services.json").exists()) apply(plugin = "com.google.gms.google-services")

// release-please keeps the app version in version.txt.
val appVersion = rootProject.file("version.txt").readText().trim()

// Point a build at another server with -Phomeoremedica.apiBaseUrl=http://10.0.2.2:8000
val apiBaseUrl = providers.gradleProperty("homeoremedica.apiBaseUrl")
    .orElse("https://homeoremedica-619837289655.asia-south1.run.app")
    .get()
    .trimEnd('/')

// Release builds are signed with the Play upload key named in keystore.properties (see
// keystore.properties.example); without the file they build unsigned.
val keystoreFile = rootProject.file("keystore.properties")
val keystore = Properties().apply {
    if (keystoreFile.exists()) keystoreFile.inputStream().use(::load)
}

android {
    namespace = "io.github.rasagyavatsal.homeoremedica"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.rasagyavatsal.homeoremedica"
        minSdk = 26
        targetSdk = 37
        // Play Publisher replaces this with the next code after Play's highest when publishing.
        versionCode = 1
        versionName = appVersion
        buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
    }

    signingConfigs {
        if (keystoreFile.exists()) {
            create("upload") {
                storeFile = rootProject.file(keystore.getProperty("storeFile"))
                storePassword = keystore.getProperty("storePassword")
                keyAlias = keystore.getProperty("keyAlias")
                keyPassword = keystore.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.findByName("upload")
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

// Publish with ./gradlew publishBundle. Point -Phomeoremedica.playCredentials (or
// ~/.gradle/gradle.properties) at the service account's JSON key, or put the key's contents in
// ANDROID_PUBLISHER_CREDENTIALS.
play {
    providers.gradleProperty("homeoremedica.playCredentials").orNull?.let {
        serviceAccountCredentials.set(file(it))
    }
    defaultToAppBundles.set(true)
    track.set("internal")
    resolutionStrategy.set(ResolutionStrategy.AUTO)
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
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.auth)
    implementation(libs.kotlinx.coroutines.play.services)
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services)
    implementation(libs.googleid)
    debugImplementation(libs.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
}
