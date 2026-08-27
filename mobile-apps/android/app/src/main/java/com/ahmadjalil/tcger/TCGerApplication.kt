package com.ahmadjalil.tcger

import android.app.Application
import com.ahmadjalil.tcger.data.local.TCGerDatabase
import com.ahmadjalil.tcger.data.preferences.PreferencesStore
import com.ahmadjalil.tcger.data.remote.RemoteServiceFactory
import com.ahmadjalil.tcger.data.repository.DefaultTCGerRepository
import com.ahmadjalil.tcger.data.scanner.OnDeviceCardTextRecognizer
import com.ahmadjalil.tcger.domain.TCGerRepository

class TCGerApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        val database = TCGerDatabase.create(this)
        val preferences = PreferencesStore(this)
        container = AppContainer(
            preferences = preferences,
            repository = DefaultTCGerRepository(
                this,
                database.dao(),
                preferences,
                RemoteServiceFactory(),
                OnDeviceCardTextRecognizer(),
            ),
        )
    }
}

data class AppContainer(
    val preferences: PreferencesStore,
    val repository: TCGerRepository,
)
