package com.ahmadjalil.tcger.data.remote

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized
import retrofit2.HttpException

@RunWith(Parameterized::class)
class ServerAPIContractTest(private val interactionId: String) {
    companion object {
        private val registry = Json.parseToJsonElement(
            requireNotNull(ServerAPIContractTest::class.java.classLoader?.getResourceAsStream("interactions.json")) {
                "Shared API interaction fixture is missing"
            }.bufferedReader().use { it.readText() },
        ).jsonObject
        @JvmStatic
        @Parameterized.Parameters(name = "[api:{0}] android consumer")
        fun interactions() = registry.getValue("interactions").jsonArray.map {
            arrayOf(it.jsonObject.getValue("id").jsonPrimitive.content)
        }
    }

    @Test
    fun contract() = runBlocking {
        val interaction = registry.getValue("interactions").jsonArray.first {
            it.jsonObject.getValue("id").jsonPrimitive.content == interactionId
        }.jsonObject
        val request = interaction.getValue("request").jsonObject
        val expected = interaction.getValue("response").jsonObject
        val payload = expected.getValue("body")
        val status = expected.getValue("status").jsonPrimitive.int
        var requests = 0
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            requests++
            val actual = chain.request()
            assertEquals(request.getValue("path").jsonPrimitive.content, actual.url.encodedPath)
            assertEquals(request.getValue("method").jsonPrimitive.content, actual.method)
            request.getValue("headers").jsonObject.forEach { (key, value) ->
                assertEquals(value.jsonPrimitive.content, actual.header(key))
            }
            val query = request["query"]?.jsonObject ?: JsonObject(emptyMap())
            assertEquals(query.size, actual.url.querySize)
            query.forEach { (key, value) -> assertEquals(value.jsonPrimitive.content, actual.url.queryParameter(key)) }
            request["body"]?.let {
                assertTrue(actual.body?.contentType().toString().startsWith("application/json"))
                val buffer = Buffer()
                requireNotNull(actual.body).writeTo(buffer)
                assertEquals(it, Json.parseToJsonElement(buffer.readUtf8()))
            }
            val responseBody = if (payload is JsonObject) JsonObject(payload + ("futureServerField" to JsonPrimitive(true))) else payload
            Response.Builder().request(actual).protocol(Protocol.HTTP_1_1).code(status).message("Contract fixture")
                .body(responseBody.toString().toResponseBody("application/json".toMediaType())).build()
        }.build()
        // Exercise the production factory's Retrofit annotations and JSON codec.
        val api = RemoteServiceFactory(client).create("https://contract.test")
        val auth = request.getValue("headers").jsonObject.getValue("Authorization").jsonPrimitive.content
        val operation = interaction.getValue("operation").jsonPrimitive.content
        try {
            when (operation) {
                "listBinders" -> {
                    val result = api.getBinders(auth)
                    assertTrue("Expected HTTP failure", status < 400)
                    assertEquals(payload.jsonArray.size, result.size)
                    result.zip(payload.jsonArray).forEach { (binder, fields) -> assertBinder(binder, fields.jsonObject) }
                }
                "createBinder" -> {
                    val input = Json.decodeFromJsonElement<CreateBinderRequest>(request.getValue("body"))
                    val result = api.createBinder(auth, input)
                    assertTrue("Expected HTTP failure", status < 400)
                    assertBinder(result, payload.jsonObject)
                }
                "updateBinder" -> {
                    val result = api.updateBinder(auth, "contract-binder", request.getValue("body").jsonObject)
                    assertTrue("Expected HTTP failure", status < 400)
                    assertBinder(result, payload.jsonObject)
                }
                "deleteBinder" -> {
                    api.deleteBinder(auth, "contract-binder")
                    assertEquals(204, status)
                }
                "addCopy" -> {
                    val result = api.addCard(auth, "contract-binder", request.getValue("body").jsonObject)
                    assertTrue("Expected HTTP failure", status < 400)
                    assertEquals(payload.jsonObject.getValue("copies").jsonArray.single().jsonObject.getValue("id").jsonPrimitive.content, result.createdCopyId)
                }
                "updateCopy" -> {
                    val result = api.updateCard(auth, "contract-binder", "contract-copy", request.getValue("body").jsonObject)
                    assertTrue("Expected HTTP failure", status < 400)
                    val fields = payload.jsonObject
                    assertEquals(fields.getValue("name").jsonPrimitive.content, result.name)
                    assertEquals(fields.getValue("quantity").jsonPrimitive.int, result.quantity)
                    assertEquals(fields.getValue("copies").jsonArray.size, result.copies.size)
                    result.copies.zip(fields.getValue("copies").jsonArray).forEach { (copy, expectedCopy) ->
                        val data = expectedCopy.jsonObject
                        assertEquals(data.getValue("id").jsonPrimitive.content, copy.id)
                        assertEquals(data["condition"]?.jsonPrimitive?.content, copy.condition)
                        assertEquals(data["acquisitionPrice"]?.jsonPrimitive?.double, copy.acquisitionPrice)
                        assertEquals(data["notes"]?.jsonPrimitive?.content, copy.notes)
                        assertEquals(data["acquiredAt"]?.jsonPrimitive?.content, copy.acquiredAt)
                        assertEquals(data["gradingCompany"]?.jsonPrimitive?.content, copy.gradingCompany)
                        assertEquals(data["gradingScore"]?.jsonPrimitive?.content, copy.gradingScore)
                        assertEquals(data["certNumber"]?.jsonPrimitive?.content, copy.certNumber)
                        assertEquals(data["storageLocation"]?.jsonPrimitive?.content, copy.storageLocation)
                    }
                }
                "removeCopy" -> { api.removeCard(auth, "contract-binder", "contract-copy"); assertEquals(204, status) }
                "openSealed" -> {
                    val result = api.createSealedOpening(auth, "contract-inventory", Json.decodeFromJsonElement<CreateSealedOpeningRequest>(request.getValue("body")))
                    assertTrue("Expected HTTP failure", status < 400)
                    val fields = payload.jsonObject
                    assertEquals(fields.getValue("id").jsonPrimitive.content, result.id)
                    assertEquals(fields.getValue("sealedInventoryId").jsonPrimitive.content, result.sealedInventoryId)
                    assertEquals(fields.getValue("openedQuantity").jsonPrimitive.int, result.openedQuantity)
                    assertEquals(fields.getValue("openedAt").jsonPrimitive.content, result.openedAt)
                    assertEquals(fields.getValue("notes").jsonPrimitive.content, result.notes)
                }
                "importBackup" -> {
                    val result = api.importBackup(auth, request.getValue("body").jsonObject)
                    assertTrue("Expected HTTP failure", status < 400)
                    for ((key, value) in payload.jsonObject) assertEquals(value, result[key])
                }
                "searchCards" -> {
                    val query = request.getValue("query").jsonObject
                    val result = api.searchCards(auth, query.getValue("query").jsonPrimitive.content, query.getValue("tcg").jsonPrimitive.content)
                    assertTrue("Expected HTTP failure", status < 400)
                    assertEquals(payload.jsonObject.getValue("total").jsonPrimitive.int, result.total)
                    val cards = payload.jsonObject.getValue("cards").jsonArray
                    assertEquals(cards.size, result.cards.size)
                    result.cards.zip(cards).forEach { (card, fields) ->
                        val data = fields.jsonObject
                        assertEquals(data.getValue("id").jsonPrimitive.content, card.id)
                        assertEquals(data.getValue("name").jsonPrimitive.content, card.name)
                        assertEquals(data.getValue("tcg").jsonPrimitive.content, card.tcg)
                        assertEquals(data.getValue("setCode").jsonPrimitive.content, card.setCode)
                        assertEquals(data.getValue("collectorNumber").jsonPrimitive.content, card.collectorNumber)
                    }
                }
                else -> error("Uncovered Android operation: $operation")
            }
        } catch (error: HttpException) {
            assertTrue("Unexpected HTTP failure", status >= 400)
            assertEquals(status, error.code())
            val body = Json.parseToJsonElement(requireNotNull(error.response()?.errorBody()).string()).jsonObject
            assertEquals(payload.jsonObject.getValue("message"), body.getValue("message"))
        } finally {
            client.dispatcher.executorService.shutdown()
            client.connectionPool.evictAll()
        }
        assertEquals("Must actually execute the remote operation", 1, requests)
    }

    private fun assertBinder(binder: BinderDto, fields: JsonObject) {
        assertEquals(fields.getValue("id").jsonPrimitive.content, binder.id)
        assertEquals(fields.getValue("name").jsonPrimitive.content, binder.name)
        assertEquals(fields.getValue("cards").jsonArray.size, binder.cards.size)
        assertEquals(fields.getValue("createdAt").jsonPrimitive.content, binder.createdAt)
        assertEquals(fields.getValue("updatedAt").jsonPrimitive.content, binder.updatedAt)
        fields["associatedTcg"]?.let { assertEquals(it.jsonPrimitive.content, binder.associatedTcg) }
        fields["associatedSetCode"]?.let { assertEquals(it.jsonPrimitive.content, binder.associatedSetCode) }
        fields["defaultCondition"]?.let { assertEquals(it.jsonPrimitive.content, binder.defaultCondition) }
    }
}
