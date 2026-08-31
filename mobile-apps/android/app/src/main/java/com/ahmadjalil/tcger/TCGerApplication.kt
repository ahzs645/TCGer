package com.ahmadjalil.tcger

import android.app.Application
import com.ahmadjalil.tcger.data.local.TCGerDatabase
import com.ahmadjalil.tcger.data.gamepackage.GamePackageStore
import com.ahmadjalil.tcger.data.preferences.PreferencesStore
import com.ahmadjalil.tcger.data.remote.RemoteServiceFactory
import com.ahmadjalil.tcger.data.repository.DefaultTCGerRepository
import com.ahmadjalil.tcger.data.scanner.OnDeviceCardTextRecognizer
import com.ahmadjalil.tcger.data.scanner.model.ScannerAssetStore
import com.ahmadjalil.tcger.domain.TCGerRepository

class TCGerApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        val database = TCGerDatabase.create(this)
        val preferences = PreferencesStore(this)
        val scannerAssets = ScannerAssetStore(this, BuildConfig.SCANNER_ASSET_BASE_URL)
        val gamePackages = GamePackageStore(this, BuildConfig.CATALOG_BASE_URL)
        container = AppContainer(
            preferences = preferences,
            scannerAssets = scannerAssets,
            gamePackages = gamePackages,
            repository = DefaultTCGerRepository(
                this,
                database.dao(),
                preferences,
                RemoteServiceFactory(),
                OnDeviceCardTextRecognizer(),
                scannerAssets,
            ),
        )
    }
}

data class AppContainer(
    val preferences: PreferencesStore,
    val scannerAssets: ScannerAssetStore,
    val gamePackages: GamePackageStore,
    val repository: TCGerRepository,
)
