package com.ahmadjalil.tcger.ui

import android.content.Intent
import android.net.Uri
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import com.ahmadjalil.tcger.MainActivity
import org.junit.Rule
import org.junit.Test

class AppEntryPointTest {
    @get:Rule val compose = createEmptyComposeRule()

    @Test fun consumedSearchLinkDoesNotReplayAfterActivityRecreation() {
        val intent = Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java)
            .setAction(Intent.ACTION_VIEW).setData(Uri.parse("tcger://search?q=Pikachu"))
            .putExtra("tcgerParityTest", "true")
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            compose.waitUntil(15_000) { compose.onAllNodesWithText("Card search").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Pikachu", substring = false).assertIsDisplayed()
            compose.onNodeWithTag("nav.settings", useUnmergedTree = true).performClick()
            compose.onNodeWithText("Make TCGer yours").assertIsDisplayed()
            scenario.recreate()
            compose.waitUntil(15_000) { compose.onAllNodesWithText("Make TCGer yours").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Make TCGer yours").assertIsDisplayed()
            compose.onNodeWithText("Card search").assertDoesNotExist()
        }
    }
}
