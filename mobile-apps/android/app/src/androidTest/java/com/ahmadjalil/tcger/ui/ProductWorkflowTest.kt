package com.ahmadjalil.tcger.ui

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import com.ahmadjalil.tcger.domain.*
import com.ahmadjalil.tcger.ui.screens.BinderDetailScreen
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertEquals

class ProductWorkflowTest {
    @get:Rule val compose = createComposeRule()
    private val pikachu = OwnedCard("p", "b", CatalogCard("25", "Pikachu", "pokemon", collectorNumber = "25"), 1, "NM")
    private val bulbasaur = OwnedCard("q", "b", CatalogCard("1", "Bulbasaur", "pokemon", collectorNumber = "1"), 1, "LP")
    private fun show(remove: (String, String) -> Unit = { _, _ -> }) {
        compose.setContent {
            val binder = Binder("b", "Test binder", cards = listOf(pikachu, bulbasaur))
            MaterialTheme { BinderDetailScreen(binder, PaddingValues(0.dp), false, true, "USD", "", {}, {}, {}, remove,
                listOf(binder), true, { _, _, _, _ -> }, { _, _, _ -> }, { _, _, _, _ -> }, { _, _ -> }, { emptyList() }, { _, _ -> error("No server") }, { _, _ -> }) }
        }
    }
    @Test fun searchAndFilterFindCopiesWithoutLosingTheBinder() {
        show()
        compose.onNodeWithText("Search this binder").performTextInput("Pika")
        compose.onNodeWithText("Pikachu").assertIsDisplayed()
        compose.onNodeWithText("Bulbasaur").assertDoesNotExist()
        compose.onNodeWithText("Search this binder").performTextClearance()
        compose.onNodeWithText("Filter & sort").performClick()
        compose.onNodeWithText("All conditions").performClick()
        compose.onNode(hasText("LP") and hasAnyAncestor(isPopup())).performClick()
        compose.onNodeWithText("Done").performClick()
        compose.onNodeWithText("Bulbasaur").assertIsDisplayed()
        compose.onNodeWithText("Pikachu").assertDoesNotExist()
    }
    @Test fun deletingRequiresConfirmationAndCancelKeepsTheCopy() {
        var removals = 0
        show { _, _ -> removals++ }
        compose.onNodeWithContentDescription("Remove Pikachu").performClick()
        compose.onNodeWithText("Remove this copy?").assertIsDisplayed()
        assertEquals(0, removals)
        compose.onNodeWithText("Cancel").performClick()
        assertEquals(0, removals)
        compose.onNodeWithContentDescription("Remove Pikachu").performClick()
        compose.onNodeWithText("Remove", substring = false).performClick()
        compose.runOnIdle { assertEquals(1, removals) }
    }
    @Test fun editingUsesTheDedicatedCopyScreen() {
        show()
        compose.onNodeWithText("Pikachu").performClick()
        compose.onNodeWithTag("collection.copy.editor").assertIsDisplayed()
        compose.onNodeWithText("Condition", substring = false).assertIsDisplayed()
        compose.onNodeWithText("Finish code").assertDoesNotExist()
        compose.onNodeWithText("Cancel").performClick()
        compose.onNodeWithText("Search this binder").assertIsDisplayed()
    }
}
