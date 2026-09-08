import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

/**
 * `local.properties` (gitignored — see apps/android/.gitignore) as a personal-machine override
 * layer between the checked-in `gradle.properties` defaults and an explicit `-P` flag. Written
 * automatically by `scripts/local-lan-demo.ps1` after a local-chain-over-LAN run, so a later
 * plain `./gradlew installDebug` — no flags — keeps pointing at your machine's LAN IP and the
 * last contract address that script deployed, instead of the emulator alias every time.
 */
val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

/**
 * Read a config knob with priority: an explicit `-PkrishichainX=...` on this invocation's
 * command line, then `local.properties`, then the checked-in `gradle.properties` default. See
 * that file for the full explanation of these knobs and how they mirror the repo root's
 * `.env.example`.
 *
 * `gradle.startParameter.projectProperties` — not `project.findProperty` — is what actually
 * distinguishes "passed with -P this run" from "came from gradle.properties": by the time
 * `findProperty` resolves a value, Gradle has already merged both sources and the distinction is
 * gone, which is exactly the layer `local.properties` needs to slot into.
 */
fun gradleProp(name: String): String {
    gradle.startParameter.projectProperties[name]?.let { if (it.isNotBlank()) return it }
    localProperties.getProperty(name)?.let { if (it.isNotBlank()) return it }
    return (project.findProperty(name) as String?).orEmpty()
}

android {
    namespace = "com.krishichain.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.krishichain.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // --- mirrors apps/web's NEXT_PUBLIC_* env vars (see .env.example at the repo root) ---
        buildConfigField("String", "GATEWAY_BASE_URL", "\"${gradleProp("krishichainGatewayUrl")}\"")
        buildConfigField("String", "VERIFY_RPC_URL", "\"${gradleProp("krishichainVerifyRpcUrl")}\"")
        buildConfigField("int", "VERIFY_CHAIN_ID", gradleProp("krishichainVerifyChainId").ifBlank { "80002" })
        buildConfigField(
            "String",
            "BATCH_ANCHOR_ADDRESS_OVERRIDE",
            "\"${gradleProp("krishichainBatchAnchorAddress")}\"",
        )
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.09.00"))

    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.0")
    implementation("androidx.activity:activity-compose:1.10.1")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.compose.material:material-icons-extended")

    // Single verify screen today; a real NavHost route so a Phase 2 sensor-node screen slots in
    // as a second destination without restructuring anything (see MainActivity / KrishiChainNavHost).
    implementation("androidx.navigation:navigation-compose:2.9.0")

    // Networking: GET /lot/{lotId}, GET /proof/{digest}, and the raw eth_call JSON-RPC POST.
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-kotlinx-serialization:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    // keccak256 for Merkle proof re-verification. Bouncy Castle's KeccakDigest, NOT
    // MessageDigest.getInstance("SHA3-256") — see domain/Keccak.kt for why.
    implementation("org.bouncycastle:bcprov-jdk18on:1.80")

    // QR scanning (Scan tab): CameraX for the preview + frame stream, ML Kit for on-device
    // barcode decoding. Both stay fully local — no network call, no Google Play Services
    // bottom-sheet UI — so the viewfinder can be themed like the rest of the app and the demo's
    // no-internet invariant (CLAUDE.md #6) holds.
    val cameraxVersion = "1.4.1"
    implementation("androidx.camera:camera-core:$cameraxVersion")
    implementation("androidx.camera:camera-camera2:$cameraxVersion")
    implementation("androidx.camera:camera-lifecycle:$cameraxVersion")
    implementation("androidx.camera:camera-view:$cameraxVersion")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")

    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")

    androidTestImplementation(platform("androidx.compose:compose-bom:2025.09.00"))
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
}
