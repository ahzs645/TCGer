package com.ahmadjalil.tcger.data.remote

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test
import retrofit2.HttpException

class NativeAuthOriginTest {
    @Test
    fun signInAndSignUpSendOnlyTheConfiguredApiOrigin() = runBlocking {
        val cases = listOf(
            "https://API.example.test:443/tcger/api/" to "https://api.example.test",
            "http://localhost:3004/api/" to "http://localhost:3004",
            "https://[2001:db8::1]:8443/gateway/api/" to "https://[2001:db8::1]:8443",
        )
        for ((baseUrl, expectedOrigin) in cases) {
            val paths = mutableListOf<String>()
            val client = OkHttpClient.Builder().addInterceptor { chain ->
                val request = chain.request()
                paths += request.url.encodedPath
                assertEquals(expectedOrigin, request.header("Origin"))
                assertEquals("POST", request.method)
                Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("Auth fixture")
                    .body("""{"token":"confirmed-token"}""".toResponseBody("application/json".toMediaType())).build()
            }.build()
            val api = RemoteServiceFactory(client).create(baseUrl)
            assertEquals("confirmed-token", api.signIn(SignInRequest("collector", "password" )).token)
            assertEquals("confirmed-token", api.signUp(buildJsonObject {
                put("email", "collector@example.test"); put("username", "collector"); put("password", "password"); put("name", "Collector")
            }).token)
            assertEquals(2, paths.size)
            assertTrue(paths[0].endsWith("/auth/sign-in/username"))
            assertTrue(paths[1].endsWith("/auth/sign-up/email"))
        }
    }

    @Test
    fun nonAuthRequestsDoNotAcquireAnOriginHeader() = runBlocking {
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            assertNull(request.header("Origin"))
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("Fixture")
                .body("[]".toResponseBody("application/json".toMediaType())).build()
        }.build()
        assertTrue(RemoteServiceFactory(client).create("https://api.example.test/api/").getBinders("Bearer token").isEmpty())
    }

    @Test
    fun passwordAndAccountAliasesSendOriginButProfilePatchDoesNot() = runBlocking {
        val requests = mutableListOf<String>()
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            requests += "${request.method} ${request.url.encodedPath}"
            if (request.method == "PATCH") assertNull(request.header("Origin"))
            else assertEquals("https://api.example.test:8443", request.header("Origin"))
            assertEquals("Bearer account-token", request.header("Authorization"))
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("Auth alias fixture")
                .body("{}".toResponseBody("application/json".toMediaType())).build()
        }.build()
        val api = RemoteServiceFactory(client).create("https://api.example.test:8443/gateway/api/")
        api.changePassword("Bearer account-token", buildJsonObject { put("currentPassword", "old"); put("newPassword", "new") })
        api.deleteAccount("Bearer account-token", buildJsonObject { put("password", "new") })
        api.updateProfile("Bearer account-token", buildJsonObject { put("username", "collector") })
        assertEquals(listOf("POST /gateway/api/users/me/change-password", "DELETE /gateway/api/users/me", "PATCH /gateway/api/users/me"), requests)
    }

    @Test
    fun untrustedOriginFailureIsSurfacedWithoutRetryingOrBypassingChecks() = runBlocking {
        var calls = 0
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            calls++
            val request = chain.request()
            assertEquals("https://api.example.test", request.header("Origin"))
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(403).message("Untrusted origin")
                .body("""{"message":"Invalid origin"}""".toResponseBody("application/json".toMediaType())).build()
        }.build()
        try {
            RemoteServiceFactory(client).create("https://api.example.test/api/").signIn(SignInRequest("collector", "password"))
            fail("Expected the server origin rejection")
        } catch (error: HttpException) {
            assertEquals(403, error.code())
        }
        assertEquals(1, calls)
    }
}
