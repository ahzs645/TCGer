package com.ahmadjalil.tcger.data.remote

import com.ahmadjalil.tcger.data.preferences.normalizeServerUrl
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit

class RemoteServiceFactory {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val client = OkHttpClient.Builder()
        .addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC })
        .build()

    fun create(rawUrl: String): TCGerApi = Retrofit.Builder()
        .baseUrl(normalizeServerUrl(rawUrl))
        .client(client)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()
        .create(TCGerApi::class.java)
}
