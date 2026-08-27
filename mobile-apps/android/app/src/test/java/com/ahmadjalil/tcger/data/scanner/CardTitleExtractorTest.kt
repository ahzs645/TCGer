package com.ahmadjalil.tcger.data.scanner

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CardTitleExtractorTest {
    @Test
    fun findsPokemonNameAndDropsCardStats() {
        val queries = CardTitleExtractor.candidateQueries(
            """
            BASIC
            Pikachu ex
            HP 190
            Thunder Shock 30
            Weakness ×2
            """.trimIndent(),
        )

        assertEquals("Pikachu ex", queries.first())
        assertFalse(queries.any { it.startsWith("HP") })
        assertFalse(queries.any { it.startsWith("Weakness") })
    }

    @Test
    fun preservesMagicNamesWithPunctuation() {
        val queries = CardTitleExtractor.candidateQueries(
            """
            Krenko, Mob Boss
            Legendary Creature — Goblin Warrior
            Whenever Krenko attacks, create a token.
            """.trimIndent(),
        )

        assertTrue("Krenko, Mob Boss" in queries)
    }

    @Test
    fun rejectsUnreadableNumericNoise() {
        assertTrue(CardTitleExtractor.candidateQueries("1234\n20/165\n•••").isEmpty())
    }
}
