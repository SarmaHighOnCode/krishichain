import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

/** Read a Gradle property, or fall back to its `gradle.properties` default. See that file for
 *  the full explanation of these knobs and how they mirror the repo root's `.env.example`. */
fun gradleProp(name: String): String = (project.findProperty(name) as String?).orEmpty()

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

    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")

    androidTestImplementation(platform("androidx.compose:compose-bom:2025.09.00"))
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
}
