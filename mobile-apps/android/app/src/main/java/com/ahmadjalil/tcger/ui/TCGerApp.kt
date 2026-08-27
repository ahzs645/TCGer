package com.ahmadjalil.tcger.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CollectionsBookmark
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.ahmadjalil.tcger.AppContainer
import com.ahmadjalil.tcger.ParityTestMode
import com.ahmadjalil.tcger.data.scanner.AndroidScannerRequestHandler
import com.ahmadjalil.tcger.data.scanner.AndroidScannerResultRequestHandler
import com.ahmadjalil.tcger.generated.ParityControlIDs
import com.ahmadjalil.tcger.ui.screens.BinderDetailScreen
import com.ahmadjalil.tcger.ui.screens.CollectionsScreen
import com.ahmadjalil.tcger.ui.screens.DashboardScreen
import com.ahmadjalil.tcger.ui.screens.SearchScreen
import com.ahmadjalil.tcger.ui.screens.ScannerScreen
import com.ahmadjalil.tcger.ui.screens.SettingsScreen
import com.ahmadjalil.tcger.ui.screens.ServerDebugCapturesScreen
import com.ahmadjalil.tcger.ui.screens.WishlistsScreen
import com.ahmadjalil.tcger.ui.packopening.PackOpeningPullSession
import com.ahmadjalil.tcger.ui.packopening.PackOpeningPull
import com.ahmadjalil.tcger.ui.packopening.PackOpeningScreen
import com.ahmadjalil.tcger.ui.packopening.PackOpeningSaveCheckpoint
import com.ahmadjalil.tcger.ui.packopening.canRecordOpening
import com.ahmadjalil.tcger.ui.packopening.toCatalogCard
import com.ahmadjalil.tcger.ui.theme.TCGerTheme

private enum class TopDestination(val route: String, val label: String) {
    HOME("home", "Home"),
    COLLECTIONS("collections", "Binders"),
    SEARCH("search", "Search"),
    WISHLISTS("wishlists", "Wishlists"),
    SETTINGS("settings", "Settings"),
}

@Composable
@OptIn(ExperimentalComposeUiApi::class)
fun TCGerApp(container: AppContainer) {
    val viewModel: AppViewModel = viewModel(factory = AppViewModel.factory(container))
    val state by viewModel.state.collectAsStateWithLifecycle()

    LaunchedEffect(ParityTestMode.isEnabled) {
        if (ParityTestMode.isEnabled) container.preferences.useOnDevice()
    }

    TCGerTheme(state.preferences.themeMode, state.preferences.accent) {
        val navController = rememberNavController()
        val backStack by navController.currentBackStackEntryAsState()
        val route = backStack?.destination?.route
        val topLevel = TopDestination.entries.any { it.route == route }
        var pendingPackSession by remember { mutableStateOf<PackOpeningPullSession?>(null) }
        var pendingWishlistPull by remember { mutableStateOf<PackOpeningPull?>(null) }
        var selectedPackBinderId by remember { mutableStateOf<String?>(null) }
        var selectedSealedInventoryId by remember { mutableStateOf<String?>(null) }
        var packSaveCheckpoint by remember { mutableStateOf(PackOpeningSaveCheckpoint()) }
        var isSavingPack by remember { mutableStateOf(false) }

        Scaffold(
            modifier = Modifier.semantics { testTagsAsResourceId = true },
            containerColor = MaterialTheme.colorScheme.background,
            bottomBar = {
                if (topLevel) {
                    NavigationBar {
                        TopDestination.entries.forEach { destination ->
                            val icon = when (destination) {
                                TopDestination.HOME -> Icons.Default.Home
                                TopDestination.COLLECTIONS -> Icons.Default.CollectionsBookmark
                                TopDestination.SEARCH -> Icons.Default.Search
                                TopDestination.WISHLISTS -> Icons.Default.Favorite
                                TopDestination.SETTINGS -> Icons.Default.Settings
                            }
                            NavigationBarItem(
                                modifier = Modifier.testTag(destination.controlId),
                                selected = route == destination.route,
                                onClick = {
                                    navController.navigate(destination.route) {
                                        popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                        launchSingleTop = true
                                        restoreState = true
                                    }
                                },
                                icon = { Icon(icon, contentDescription = destination.label) },
                                label = { Text(destination.label) },
                            )
                        }
                    }
                }
            },
        ) { padding ->
            NavHost(navController, startDestination = TopDestination.HOME.route, modifier = Modifier) {
                composable(TopDestination.HOME.route) {
                    DashboardScreen(
                        state = state,
                        contentPadding = padding,
                        onRefresh = viewModel::refresh,
                        onScan = { navController.navigate("scanner") },
                        onOpenPacks = { navController.navigate("pack-opening") },
                        onBinder = { id -> navController.navigate("binder/$id") },
                    )
                }
                composable(TopDestination.COLLECTIONS.route) {
                    CollectionsScreen(
                        state = state,
                        contentPadding = padding,
                        onCreate = viewModel::createBinder,
                        onDelete = viewModel::deleteBinder,
                        onOpen = { id -> navController.navigate("binder/$id") },
                    )
                }
                composable(TopDestination.SEARCH.route) {
                    SearchScreen(state, padding, viewModel)
                }
                composable(TopDestination.WISHLISTS.route) {
                    WishlistsScreen(state, padding, viewModel::createWishlist, viewModel::deleteWishlist)
                }
                composable(TopDestination.SETTINGS.route) {
                    SettingsScreen(
                        state,
                        padding,
                        viewModel,
                        onServerDebugCaptures = { navController.navigate("scanner-debug-captures") },
                    )
                }
                composable("scanner") {
                    ScannerScreen(
                        state = state,
                        contentPadding = padding,
                        viewModel = viewModel,
                        onBack = navController::popBackStack,
                        scannerRequestHandler = AndroidScannerRequestHandler { viewModel.scanCard(it) },
                        guidedScannerRequestHandler = AndroidScannerResultRequestHandler { request, completion ->
                            viewModel.scanCardForGuidedCapture(request, completion)
                        },
                        bulkScannerRequestHandler = viewModel::scanCards,
                        onBulkAddToBinder = viewModel::addCardsToBinder,
                    )
                }
                composable("pack-opening") {
                    PackOpeningScreen(
                        onClose = navController::popBackStack,
                        onSavePulls = { session ->
                            pendingPackSession = session
                            selectedPackBinderId = state.binders.firstOrNull()?.id
                            selectedSealedInventoryId = null
                            packSaveCheckpoint = PackOpeningSaveCheckpoint()
                        },
                        onFavoritePull = viewModel::favoritePackPull,
                        onWishlistPull = { pendingWishlistPull = it },
                        contentPadding = padding,
                    )
                }
                composable("scanner-debug-captures") {
                    ServerDebugCapturesScreen(
                        state = state,
                        contentPadding = padding,
                        onBack = navController::popBackStack,
                        onRefresh = viewModel::loadScanDebugCaptures,
                        onUpdate = viewModel::updateScanDebugCapture,
                    )
                }
                composable("binder/{binderId}", arguments = listOf(navArgument("binderId") { type = NavType.StringType })) { entry ->
                    BinderDetailScreen(
                        binder = state.binders.firstOrNull { it.id == entry.arguments?.getString("binderId") },
                        contentPadding = padding,
                        showPricing = state.preferences.showPricing,
                        currency = state.preferences.currency,
                        onBack = navController::popBackStack,
                        onRemove = viewModel::removeCard,
                    )
                }
            }
        }

        state.message?.let { message ->
            AlertDialog(
                onDismissRequest = viewModel::clearMessage,
                title = { Text("TCGer") },
                text = { Text(message) },
                confirmButton = { TextButton(onClick = viewModel::clearMessage) { Text("OK") } },
            )
        }

        pendingPackSession?.let { session ->
            val eligibleInventory = state.sealedInventory.filter { it.canRecordOpening(session) }
            val canDismissSave = !isSavingPack && packSaveCheckpoint.savedPullCount == 0
            AlertDialog(
                onDismissRequest = { if (canDismissSave) pendingPackSession = null },
                title = { Text("Save ${session.pulls.size} pulls") },
                text = {
                    if (state.binders.isEmpty()) {
                        Text("Create a binder first, then save this pack-opening session.")
                    } else {
                        androidx.compose.foundation.lazy.LazyColumn {
                            item { Text("Destination binder", style = MaterialTheme.typography.titleSmall) }
                            items(state.binders, key = { it.id }) { binder ->
                                TextButton(
                                    modifier = Modifier.testTag(ParityControlIDs.INPUT_PACK_OPENING_DESTINATION),
                                    onClick = {
                                        if (packSaveCheckpoint.savedPullCount == 0) selectedPackBinderId = binder.id
                                    },
                                    enabled = !isSavingPack && packSaveCheckpoint.savedPullCount == 0,
                                ) { Text(if (selectedPackBinderId == binder.id) "✓ ${binder.name}" else binder.name) }
                            }
                            item {
                                Spacer(Modifier.height(8.dp))
                                HorizontalDivider()
                                Spacer(Modifier.height(8.dp))
                                Text("Sealed inventory (optional)", style = MaterialTheme.typography.titleSmall)
                                TextButton(
                                    modifier = Modifier.testTag(ParityControlIDs.INPUT_PACK_OPENING_SEALED_INVENTORY),
                                    onClick = { selectedSealedInventoryId = null },
                                    enabled = !isSavingPack,
                                ) { Text(if (selectedSealedInventoryId == null) "✓ Don't update sealed inventory" else "Don't update sealed inventory") }
                            }
                            items(eligibleInventory, key = { it.id }) { item ->
                                TextButton(
                                    modifier = Modifier.testTag(ParityControlIDs.INPUT_PACK_OPENING_SEALED_INVENTORY),
                                    onClick = { selectedSealedInventoryId = item.id },
                                    enabled = !isSavingPack,
                                ) {
                                    val label = "${item.product.name} (${item.quantity} available)"
                                    Text(if (selectedSealedInventoryId == item.id) "✓ $label" else label)
                                }
                            }
                            if (eligibleInventory.isEmpty()) {
                                item {
                                    Text(
                                        when {
                                            state.preferences.dataSourceMode == com.ahmadjalil.tcger.domain.DataSourceMode.ON_DEVICE ->
                                                "Sealed inventory linkage requires a connected server."
                                            state.sealedInventoryError != null ->
                                                "Sealed inventory could not be loaded: ${state.sealedInventoryError}"
                                            else ->
                                                "No matching loose booster inventory has enough quantity for this opening."
                                        },
                                        style = MaterialTheme.typography.bodySmall,
                                    )
                                    if (state.sealedInventoryError != null) {
                                        TextButton(onClick = viewModel::refresh) { Text("Retry inventory") }
                                    }
                                }
                            }
                            if (packSaveCheckpoint.savedPullCount > 0) {
                                item {
                                    Text(
                                        "${packSaveCheckpoint.savedPullCount}/${session.pulls.size} cards saved. Retry continues from this checkpoint without duplicating cards.",
                                        style = MaterialTheme.typography.bodySmall,
                                    )
                                }
                            }
                        }
                    }
                },
                confirmButton = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (isSavingPack) CircularProgressIndicator()
                        TextButton(
                            modifier = Modifier.testTag(ParityControlIDs.ACTION_PACK_OPENING_CONFIRM_SAVE),
                            enabled = !isSavingPack && selectedPackBinderId != null,
                            onClick = {
                                val binderId = selectedPackBinderId ?: return@TextButton
                                isSavingPack = true
                                viewModel.savePackPulls(
                                    binderId = binderId,
                                    session = session,
                                    sealedInventoryId = selectedSealedInventoryId,
                                    checkpoint = packSaveCheckpoint,
                                ) { outcome ->
                                    isSavingPack = false
                                    packSaveCheckpoint = outcome.checkpoint
                                    if (outcome.completed) {
                                        pendingPackSession = null
                                        selectedPackBinderId = null
                                        selectedSealedInventoryId = null
                                        packSaveCheckpoint = PackOpeningSaveCheckpoint()
                                    }
                                }
                            },
                        ) { Text(if (packSaveCheckpoint.savedPullCount > 0) "Retry" else "Save") }
                    }
                },
                dismissButton = {
                    TextButton(
                        enabled = canDismissSave,
                        onClick = { pendingPackSession = null },
                    ) { Text("Cancel") }
                },
            )
        }

        pendingWishlistPull?.let { pull ->
            AlertDialog(
                onDismissRequest = { pendingWishlistPull = null },
                title = { Text("Add ${pull.name} to wishlist") },
                text = {
                    if (state.wishlists.isEmpty()) {
                        Text("Create a wishlist first, then inspect this pull again.")
                    } else {
                        androidx.compose.foundation.lazy.LazyColumn {
                            items(state.wishlists, key = { it.id }) { wishlist ->
                                TextButton(
                                    onClick = {
                                        viewModel.addWishlistCard(
                                            wishlist.id,
                                            pull.toCatalogCard(),
                                        )
                                        pendingWishlistPull = null
                                    },
                                ) { Text(wishlist.name) }
                            }
                        }
                    }
                },
                confirmButton = {
                    TextButton(onClick = { pendingWishlistPull = null }) { Text("Cancel") }
                },
            )
        }
    }
}

private val TopDestination.controlId: String
    get() = when (this) {
        TopDestination.HOME -> ParityControlIDs.NAV_HOME
        TopDestination.COLLECTIONS -> ParityControlIDs.NAV_COLLECTIONS
        TopDestination.SEARCH -> ParityControlIDs.NAV_SEARCH
        TopDestination.WISHLISTS -> ParityControlIDs.NAV_WISHLISTS
        TopDestination.SETTINGS -> ParityControlIDs.NAV_SETTINGS
    }
