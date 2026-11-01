package com.ahmadjalil.tcger.data.remote

import com.ahmadjalil.tcger.data.preferences.normalizeServerUrl
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit

class RemoteServiceFactory(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC })
        .build(),
) {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    fun create(rawUrl: String): TCGerApi {
        val baseUrl = normalizeServerUrl(rawUrl).toHttpUrl()
        // Better Auth validates the origin of native auth mutations too. The
        // configured API origin must be trusted by the server; never guess a
        // different website origin or turn off that server-side validation.
        val origin = baseUrl.newBuilder().username("").password("")
            .encodedPath("/").query(null).fragment(null).build().toString().removeSuffix("/")
        val originClient = client.newBuilder().apply {
            interceptors().add(0, Interceptor { chain ->
                val request = chain.request()
                val isConfiguredOrigin = request.url.scheme == baseUrl.scheme &&
                    request.url.host == baseUrl.host && request.url.port == baseUrl.port
                val relativePath = request.url.encodedPath.takeIf { it.startsWith(baseUrl.encodedPath) }
                    ?.removePrefix(baseUrl.encodedPath)
                val isAuthMutation = (request.method !in setOf("GET", "HEAD", "OPTIONS") && relativePath?.startsWith("auth/") == true) ||
                    (request.method == "POST" && relativePath == "users/me/change-password") ||
                    (request.method == "DELETE" && relativePath == "users/me")
                chain.proceed(if (isConfiguredOrigin && isAuthMutation) {
                    request.newBuilder().header("Origin", origin).build()
                } else request)
            })
        }.build()
        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(originClient)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(TCGerApi::class.java)
    }
}
