package com.ahmadjalil.tcger.feature.libraryoperations
import java.io.File
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test
class GradingContractTest {
    @Serializable private data class Expected(val verdict: String, val population: Long, val pricedPopulation: Long, val expectedGain: Double? = null, val expectedValue: Double? = null, val totalCost: Double? = null, val rawNet: Double? = null, val breakEven: String? = null)
    @Serializable private data class Fixture(val name: String, val input: GradingScenario, val expected: Expected)
    @Test fun sharedEconomicFixtures() {
        var root = File(System.getProperty("user.dir")!!)
        while (!File(root, "mobile-parity/fixtures/grading-calculations.json").exists() && root.parentFile != null) root = root.parentFile!!
        val fixtures = Json.decodeFromString<List<Fixture>>(File(root, "mobile-parity/fixtures/grading-calculations.json").readText())
        fixtures.forEach { fixture ->
            val result = requireNotNull(fixture.input.calculate())
            assertEquals(fixture.name, fixture.expected.verdict, result.verdict)
            assertEquals(fixture.name, fixture.expected.population, result.population)
            assertEquals(fixture.name, fixture.expected.pricedPopulation, result.pricedPopulation)
            fixture.expected.expectedGain?.let { assertEquals(it, result.expectedGain!!, 0.000001) } ?: assertNull(result.expectedGain)
            fixture.expected.expectedValue?.let { assertEquals(it, result.expectedValue!!, 0.000001) }
            fixture.expected.totalCost?.let { assertEquals(it, result.totalCost, 0.000001) }
            fixture.expected.rawNet?.let { assertEquals(it, result.rawNet, 0.000001) }
            fixture.expected.breakEven?.let { assertEquals(it, result.breakEven) }
        }
    }
}
