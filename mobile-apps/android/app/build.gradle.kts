plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("com.google.devtools.ksp")
}

val scannerAssetBaseUrl = providers.gradleProperty("tcgerScannerAssetBaseUrl")
    .orElse("https://assets.tcger.ahmadjalil.com/android/scan-assets")
val catalogBaseUrl = providers.gradleProperty("tcgerCatalogBaseUrl")
    .orElse("https://assets.tcger.ahmadjalil.com/catalogs")
val requireSignedOfficialGamePackages = providers.gradleProperty("tcgerRequireSignedOfficialGamePackages")
    .map(String::toBoolean)
    .orElse(false)

android {
    namespace = "com.ahmadjalil.tcger"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.ahmadjalil.tcger"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"

        buildConfigField(
            "String",
            "SCANNER_ASSET_BASE_URL",
            "\"${scannerAssetBaseUrl.get()}\"",
        )
        buildConfigField(
            "String",
            "CATALOG_BASE_URL",
            "\"${catalogBaseUrl.get()}\"",
        )
        buildConfigField(
            "boolean",
            "REQUIRE_SIGNED_OFFICIAL_GAME_PACKAGES",
            requireSignedOfficialGamePackages.get().toString(),
        )

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables.useSupportLibrary = true
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
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

    packaging.resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"

    sourceSets.getByName("androidTest").assets.srcDir(
        "../../ios/TCGer/TCGer/Assets.xcassets/DemoCards",
    )
    sourceSets.getByName("main").assets.srcDir(
        "../../ios/TCGer/TCGer/Resources/PackOpening.bundle",
    )
    // Game-specific recognition packages are installed on first use. Keep
    // the checked-in evaluation artifacts available to tooling without
    // shipping them in the APK/AAB.
    sourceSets.getByName("main").assets.exclude(
        "scan-index/**",
        "licenses/DINOv2-APACHE-2.0.txt",
        "licenses/DINOv2-NOTICE.txt",
    )
    sourceSets.getByName("test").resources.srcDir(
        "../../../docs/scanner-system/examples",
    )
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    val cameraXVersion = "1.5.3"

    implementation(composeBom)
    androidTestImplementation(composeBom)
    implementation("androidx.activity:activity-compose:1.10.0")
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.navigation:navigation-compose:2.8.5")

    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")
    implementation("com.jakewharton.retrofit:retrofit2-kotlinx-serialization-converter:1.0.0")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("org.bouncycastle:bcprov-jdk18on:1.81")

    implementation("androidx.camera:camera-core:$cameraXVersion")
    implementation("androidx.camera:camera-camera2:$cameraXVersion")
    implementation("androidx.camera:camera-lifecycle:$cameraXVersion")
    implementation("androidx.camera:camera-view:$cameraXVersion")
    implementation("com.google.mlkit:text-recognition:16.0.1")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")
    implementation("androidx.exifinterface:exifinterface:1.4.1")
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.24.3")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}
