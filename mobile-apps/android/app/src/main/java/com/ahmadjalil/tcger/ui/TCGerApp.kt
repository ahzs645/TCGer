package com.ahmadjalil.tcger.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
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
import com.ahmadjalil.tcger.R
import com.ahmadjalil.tcger.data.scanner.AndroidScannerRequestHandler
import com.ahmadjalil.tcger.data.scanner.AndroidScannerResultRequestHandler
import com.ahmadjalil.tcger.data.gamepackage.GameFeatureAdapters
import com.ahmadjalil.tcger.data.gamepackage.needsGameInstallation
import com.ahmadjalil.tcger.generated.ParityControlIDs
import com.ahmadjalil.tcger.domain.BottomNavigationItem
import com.ahmadjalil.tcger.domain.BottomNavigationLayout
import com.ahmadjalil.tcger.domain.CatalogCard
import com.ahmadjalil.tcger.domain.DataSourceMode
import com.ahmadjalil.tcger.feature.onlinecodes.OnlineCodeConnection
import com.ahmadjalil.tcger.feature.onlinecodes.OnlineCodeRepository
import com.ahmadjalil.tcger.feature.onlinecodes.OnlineCodesScreen
import com.ahmadjalil.tcger.feature.portfolio.AnalyticsScreen
import com.ahmadjalil.tcger.feature.portfolio.DefaultPortfolioRepository
import com.ahmadjalil.tcger.feature.portfolio.PortfolioConnection
import com.ahmadjalil.tcger.feature.portfolio.PricesScreen
import com.ahmadjalil.tcger.feature.settingsparity.FinanceHistoryScreen
import com.ahmadjalil.tcger.feature.settingsparity.FinanceRepository
import com.ahmadjalil.tcger.feature.settingsparity.PricingSourcePreferenceStore
import com.ahmadjalil.tcger.feature.settingsparity.PricingSourceRepository
import com.ahmadjalil.tcger.feature.settingsparity.PricingSourceSettingsScreen
import com.ahmadjalil.tcger.feature.settingsparity.ServerAccessPolicyRepository
import com.ahmadjalil.tcger.feature.settingsparity.ServerAccessPolicyScreen
import com.ahmadjalil.tcger.feature.settingsparity.SettingsFeatureConnection
import com.ahmadjalil.tcger.features.social.ActivityScreen
import com.ahmadjalil.tcger.features.social.DeckDetailScreen
import com.ahmadjalil.tcger.features.social.DecksScreen
import com.ahmadjalil.tcger.features.social.SocialFeatureFactory
import com.ahmadjalil.tcger.features.social.TradeDetailScreen
import com.ahmadjalil.tcger.features.social.TradesScreen
import com.ahmadjalil.tcger.ui.catalogparity.CatalogParityCard
import com.ahmadjalil.tcger.ui.catalogparity.CatalogSet
import com.ahmadjalil.tcger.ui.catalogparity.CollectionGuide
import com.ahmadjalil.tcger.ui.catalogparity.CollectionGuideDetailScreen
import com.ahmadjalil.tcger.ui.catalogparity.CollectionGuidesScreen
import com.ahmadjalil.tcger.ui.catalogparity.LoadedPokedexScreen
import com.ahmadjalil.tcger.ui.catalogparity.LocalCatalogParityDataSource
import com.ahmadjalil.tcger.ui.catalogparity.PokedexSpeciesDetailScreen
import com.ahmadjalil.tcger.ui.catalogparity.PokedexSpeciesProgress
import com.ahmadjalil.tcger.ui.catalogparity.RemoteCatalogParityDataSource
import com.ahmadjalil.tcger.ui.catalogparity.ResilientCatalogParityDataSource
import com.ahmadjalil.tcger.ui.catalogparity.SetBrowserScreen
import com.ahmadjalil.tcger.ui.catalogparity.SetDetailScreen
import com.ahmadjalil.tcger.ui.catalogparity.asCatalogParityCard
import com.ahmadjalil.tcger.ui.catalogparity.asOwnedPrinting
import com.ahmadjalil.tcger.ui.screens.BinderDetailScreen
import com.ahmadjalil.tcger.ui.screens.BottomNavigationCustomizationScreen
import com.ahmadjalil.tcger.ui.screens.BottomNavigationMoreScreen
import com.ahmadjalil.tcger.ui.screens.CollectionsScreen
import com.ahmadjalil.tcger.ui.screens.DashboardScreen
import com.ahmadjalil.tcger.ui.screens.GameInstallationScreen
import com.ahmadjalil.tcger.ui.screens.InstallGamePackageScreen
import com.ahmadjalil.tcger.ui.screens.OfficialGameStoreScreen
import com.ahmadjalil.tcger.ui.screens.SearchScreen
import com.ahmadjalil.tcger.ui.screens.ScannerScreen
import com.ahmadjalil.tcger.ui.screens.SealedInventoryScreen
import com.ahmadjalil.tcger.ui.screens.SettingsScreen
import com.ahmadjalil.tcger.ui.screens.ServerDebugCapturesScreen
import com.ahmadjalil.tcger.ui.screens.WishlistsScreen
import com.ahmadjalil.tcger.ui.screens.WishlistDetailScreen
import com.ahmadjalil.tcger.ui.packopening.PackOpeningPullSession
import com.ahmadjalil.tcger.ui.packopening.PackOpeningPull
import com.ahmadjalil.tcger.ui.packopening.PackOpeningScreen
import com.ahmadjalil.tcger.ui.packopening.PackOpeningSaveCheckpoint
import com.ahmadjalil.tcger.ui.packopening.canRecordOpening
import com.ahmadjalil.tcger.ui.packopening.toCatalogCard
import com.ahmadjalil.tcger.ui.theme.TCGerTheme
import kotlinx.coroutines.launch

private const val MORE_ROUTE = "bottom-navigation-more"
private const val CUSTOMIZE_NAVIGATION_ROUTE = "bottom-navigation-customize"
private const val GAME_STORE_ROUTE = "settings-game-store"
private const val INSTALL_GAME_URL_ROUTE = "settings-install-game-url"
private val PARITY_BOTTOM_NAVIGATION_ITEMS = listOf(
    BottomNavigationItem.HOME,
    BottomNavigationItem.COLLECTIONS,
    BottomNavigationItem.SEARCH,
    BottomNavigationItem.WISHLISTS,
    BottomNavigationItem.SETTINGS,
)

@Composable
@OptIn(ExperimentalComposeUiApi::class)
fun TCGerApp(container: AppContainer) {
    val viewModel: AppViewModel = viewModel(factory = AppViewModel.factory(container))
    val state by viewModel.state.collectAsStateWithLifecycle()

    LaunchedEffect(ParityTestMode.isEnabled) {
        if (ParityTestMode.isEnabled) container.preferences.useOnDevice()
    }

    TCGerTheme(state.preferences.themeMode, state.preferences.accent) {
        val context = LocalContext.current
        val scope = rememberCoroutineScope()
        val navController = rememberNavController()
        val backStack by navController.currentBackStackEntryAsState()
        val route = backStack?.destination?.route
        val shouldInstallGame = !ParityTestMode.isEnabled && needsGameInstallation(
            state.preferences.enabledGames,
            state.gamePackages.installed.size,
        )
        if (shouldInstallGame) {
            GameInstallationScreen(
                state = state.gamePackages,
                enabledGames = state.preferences.enabledGames,
                onRefresh = viewModel::refreshOfficialGamePackages,
                onEnable = viewModel::installOfficialGamePackage,
                onInstall = viewModel::installGamePackage,
            )
            return@TCGerTheme
        }
        val pokedexCatalogIds = remember(
            state.preferences.enabledGames,
            state.gamePackages.official,
            state.gamePackages.installed,
        ) {
            buildSet {
                state.gamePackages.official.forEach { manifest ->
                    if (
                        manifest.game.id in state.preferences.enabledGames &&
                        manifest.effectiveDefinition.interfaces?.supportsFeature(GameFeatureAdapters.POKEDEX) == true
                    ) add(manifest.game.id)
                }
                state.gamePackages.installed.forEach { installed ->
                    if (installed.manifest.effectiveDefinition.interfaces?.supportsFeature(GameFeatureAdapters.POKEDEX) == true) {
                        add(installed.id)
                    }
                }
            }
        }
        val supportsPokedex = pokedexCatalogIds.isNotEmpty()
        val requestedDestinations = if (ParityTestMode.isEnabled) {
            PARITY_BOTTOM_NAVIGATION_ITEMS
        } else {
            state.preferences.visibleBottomNavigationItems
                .ifEmpty { listOf(BottomNavigationItem.SETTINGS) }
        }
        val visibleDestinations = requestedDestinations.filter { destination ->
            destination != BottomNavigationItem.POKEDEX || supportsPokedex
        }.ifEmpty { listOf(BottomNavigationItem.SETTINGS) }
        val navigationLayout = BottomNavigationLayout(visibleDestinations)
        val primaryDestinations = navigationLayout.primaryItems
        val overflowDestinations = navigationLayout.overflowItems
        val topLevel = route == MORE_ROUTE || visibleDestinations.any { it.route == route }
        var pendingPackSession by remember { mutableStateOf<PackOpeningPullSession?>(null) }
        var pendingWishlistPull by remember { mutableStateOf<PackOpeningPull?>(null) }
        var selectedPackBinderId by remember { mutableStateOf<String?>(null) }
        var selectedSealedInventoryId by remember { mutableStateOf<String?>(null) }
        var packSaveCheckpoint by remember { mutableStateOf(PackOpeningSaveCheckpoint()) }
        var isSavingPack by remember { mutableStateOf(false) }
        var installedCatalogCards by remember { mutableStateOf<List<CatalogParityCard>>(emptyList()) }
        var selectedSet by remember { mutableStateOf<CatalogSet?>(null) }
        var selectedSpecies by remember { mutableStateOf<PokedexSpeciesProgress?>(null) }
        var selectedGuide by remember { mutableStateOf<CollectionGuide?>(null) }

        LaunchedEffect(state.gamePackages.installed) {
            installedCatalogCards = state.gamePackages.installed.flatMap { installed ->
                runCatching {
                    container.gamePackages.cards(installed.id).map { card ->
                        card.asCatalogParityCard(installed.id)
                    }
                }.getOrDefault(emptyList())
            }
        }
        val ownedPrintings = remember(state.binders) {
            state.binders.flatMap { binder -> binder.cards.map { it.asOwnedPrinting() } }
        }
        val localCatalogCards = remember(installedCatalogCards, state.binders, state.searchResults) {
            (installedCatalogCards + state.binders.flatMap { binder ->
                binder.cards.map { it.card.asCatalogParityCard() }
            } + state.searchResults.map { it.asCatalogParityCard() })
                .distinctBy { "${it.tcg.lowercase()}:${it.id}" }
        }
        val localCatalogSource = remember(localCatalogCards) {
            LocalCatalogParityDataSource(localCatalogCards) { _, wishlistName, cards ->
                viewModel.createGuideWishlist(wishlistName, cards.map(CatalogParityCard::toDomainCard))
            }
        }
        val catalogSource = remember(
            localCatalogSource,
            state.preferences.dataSourceMode,
            state.preferences.serverUrl,
            state.preferences.authToken,
        ) {
            val remote = if (
                state.preferences.dataSourceMode == DataSourceMode.SERVER &&
                state.preferences.serverUrl.isNotBlank() &&
                !state.preferences.authToken.isNullOrBlank()
            ) runCatching {
                RemoteCatalogParityDataSource(
                    state.preferences.serverUrl,
                    requireNotNull(state.preferences.authToken),
                )
            }.getOrNull() else null
            if (remote == null) localCatalogSource else ResilientCatalogParityDataSource(remote, localCatalogSource)
        }
        val connectedServerUrl = state.preferences.serverUrl.takeIf {
            state.preferences.dataSourceMode == DataSourceMode.SERVER && state.preferences.isSignedIn
        }.orEmpty()
        val onlineCodeRepository = remember(context, connectedServerUrl, state.preferences.authToken) {
            OnlineCodeRepository.create(
                context,
                OnlineCodeConnection(connectedServerUrl, state.preferences.authToken),
            )
        }
        val settingsConnection = remember(connectedServerUrl, state.preferences.authToken) {
            SettingsFeatureConnection(connectedServerUrl, state.preferences.authToken)
        }
        val pricingSourceRepository = remember(settingsConnection) { PricingSourceRepository(settingsConnection) }
        val pricingSourceStore = remember(context) { PricingSourcePreferenceStore(context) }
        val portfolioRepository = remember(connectedServerUrl, state.preferences.authToken, pricingSourceStore) {
            DefaultPortfolioRepository(
                PortfolioConnection(connectedServerUrl, state.preferences.authToken),
                priceSourceResolver = pricingSourceStore::resolvedSource,
            )
        }
        val financeRepository = remember(context, settingsConnection) {
            FinanceRepository.create(context, settingsConnection)
        }
        val serverAccessRepository = remember(settingsConnection) {
            ServerAccessPolicyRepository(settingsConnection)
        }
        val socialController = remember(connectedServerUrl, state.preferences.authToken, state.preferences.userId) {
            SocialFeatureFactory.createController(
                connectedServerUrl,
                state.preferences.authToken,
                state.preferences.userId,
            )
        }
        DisposableEffect(socialController) { onDispose(socialController::close) }

        fun addSetToWishlist(set: CatalogSet) {
            scope.launch {
                runCatching { catalogSource.setCards(set.tcg, set.code) }.onSuccess { cards ->
                    viewModel.createWishlistWithCards(
                        set.name,
                        cards.map(CatalogParityCard::toDomainCard),
                    )
                }
            }
        }

        fun openCatalogCard(card: CatalogParityCard) {
            viewModel.setSearchQuery(card.name)
            navController.navigate(BottomNavigationItem.SEARCH.route)
        }

        fun navigateTo(destination: BottomNavigationItem) {
            navController.navigate(destination.route) {
                popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                launchSingleTop = true
                restoreState = true
            }
        }

        LaunchedEffect(visibleDestinations, route, supportsPokedex) {
            val currentDestination = BottomNavigationItem.entries.firstOrNull { it.route == route }
            if (currentDestination != null && currentDestination !in visibleDestinations) {
                val fallback = if (currentDestination == BottomNavigationItem.POKEDEX && !supportsPokedex) {
                    BottomNavigationItem.SETTINGS
                } else {
                    visibleDestinations.first()
                }
                navigateTo(fallback)
            }
        }

        Scaffold(
            modifier = Modifier.semantics { testTagsAsResourceId = true },
            containerColor = MaterialTheme.colorScheme.background,
            bottomBar = {
                if (topLevel) {
                    NavigationBar {
                        primaryDestinations.forEach { destination ->
                            val label = stringResource(destination.labelRes)
                            NavigationBarItem(
                                modifier = Modifier.testTag(destination.controlId),
                                selected = route == destination.route,
                                onClick = { navigateTo(destination) },
                                icon = { Icon(destination.icon, contentDescription = label) },
                                label = { Text(label) },
                            )
                        }
                        if (navigationLayout.usesOverflow) {
                            val moreLabel = stringResource(R.string.nav_more)
                            NavigationBarItem(
                                modifier = Modifier.testTag("nav.more"),
                                selected = route == MORE_ROUTE || overflowDestinations.any { it.route == route },
                                onClick = {
                                    navController.navigate(MORE_ROUTE) {
                                        popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                        launchSingleTop = true
                                        restoreState = true
                                    }
                                },
                                icon = { Icon(Icons.Default.Menu, contentDescription = moreLabel) },
                                label = { Text(moreLabel) },
                            )
                        }
                    }
                }
            },
        ) { padding ->
            NavHost(navController, startDestination = BottomNavigationItem.HOME.route, modifier = Modifier) {
                composable(BottomNavigationItem.HOME.route) {
                    DashboardScreen(
                        state = state,
                        contentPadding = padding,
                        onRefresh = viewModel::refresh,
                        onScan = { navController.navigate("scanner") },
                        onOpenPacks = { navController.navigate("pack-opening") },
                        onBinder = { id -> navController.navigate("binder/$id") },
                    )
                }
                composable(BottomNavigationItem.COLLECTIONS.route) {
                    CollectionsScreen(
                        state = state,
                        contentPadding = padding,
                        onCreate = viewModel::createBinder,
                        onDelete = viewModel::deleteBinder,
                        onOpen = { id -> navController.navigate("binder/$id") },
                    )
                }
                composable(BottomNavigationItem.SETS.route) {
                    SetBrowserScreen(
                        dataSource = catalogSource,
                        ownedCards = ownedPrintings,
                        enabledGames = state.preferences.enabledGames,
                        contentPadding = padding,
                        onOpenSet = { set ->
                            selectedSet = set
                            navController.navigate("set-detail")
                        },
                        onAddSetToWishlist = ::addSetToWishlist,
                    )
                }
                composable(BottomNavigationItem.POKEDEX.route) {
                    if (supportsPokedex) {
                        LoadedPokedexScreen(
                            dataSource = catalogSource,
                            ownedCards = ownedPrintings,
                            gameIds = pokedexCatalogIds,
                            contentPadding = padding,
                            onOpenSpecies = { species ->
                                selectedSpecies = species
                                navController.navigate("pokedex-species")
                            },
                        )
                    }
                }
                composable(BottomNavigationItem.DECKS.route) {
                    DecksScreen(
                        controller = socialController,
                        contentPadding = padding,
                        onOpenDeck = { navController.navigate("deck/$it") },
                    )
                }
                composable(BottomNavigationItem.SEARCH.route) {
                    SearchScreen(state, padding, viewModel)
                }
                composable(BottomNavigationItem.WISHLISTS.route) {
                    WishlistsScreen(
                        state = state,
                        contentPadding = padding,
                        onCreate = viewModel::createWishlist,
                        onDelete = viewModel::deleteWishlist,
                        onOpen = { id -> navController.navigate("wishlist/$id") },
                    )
                }
                composable(BottomNavigationItem.GUIDES.route) {
                    CollectionGuidesScreen(
                        dataSource = catalogSource,
                        enabledGames = state.preferences.enabledGames,
                        contentPadding = padding,
                        onOpenGuide = { guide ->
                            selectedGuide = guide
                            navController.navigate("guide-detail")
                        },
                    )
                }
                composable(BottomNavigationItem.SETTINGS.route) {
                    SettingsScreen(
                        state,
                        padding,
                        viewModel,
                        onServerDebugCaptures = { navController.navigate("scanner-debug-captures") },
                        onCustomizeBottomNavigation = { navController.navigate(CUSTOMIZE_NAVIGATION_ROUTE) },
                        onPricingSources = { navController.navigate("settings-pricing-sources") },
                        onServerAccess = { navController.navigate("settings-server-access") },
                        onFinanceHistory = { navController.navigate("settings-finance-history") },
                        onGameStore = { navController.navigate(GAME_STORE_ROUTE) },
                        onInstallGameFromUrl = { navController.navigate(INSTALL_GAME_URL_ROUTE) },
                    )
                }
                composable(BottomNavigationItem.SCAN.route) {
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
                composable(BottomNavigationItem.SEALED.route) {
                    SealedInventoryScreen(
                        state = state,
                        contentPadding = padding,
                        viewModel = viewModel,
                        onOpenPacks = { navigateTo(BottomNavigationItem.PACK_OPENING) },
                    )
                }
                composable(BottomNavigationItem.CODES.route) {
                    OnlineCodesScreen(
                        repository = onlineCodeRepository,
                        enabledGames = state.preferences.enabledGames.sorted(),
                        contentPadding = padding,
                    )
                }
                composable(BottomNavigationItem.PRICES.route) {
                    PricesScreen(
                        repository = portfolioRepository,
                        binders = state.binders,
                        showPricing = state.preferences.showPricing,
                        displayCurrency = state.preferences.currency,
                        contentPadding = padding,
                    )
                }
                composable(BottomNavigationItem.ANALYTICS.route) {
                    AnalyticsScreen(
                        repository = portfolioRepository,
                        binders = state.binders,
                        showPricing = state.preferences.showPricing,
                        displayCurrency = state.preferences.currency,
                        contentPadding = padding,
                    )
                }
                composable(BottomNavigationItem.TRADES.route) {
                    TradesScreen(
                        controller = socialController,
                        contentPadding = padding,
                        onOpenTrade = { navController.navigate("trade/$it") },
                    )
                }
                composable(BottomNavigationItem.ACTIVITY.route) {
                    ActivityScreen(socialController, padding)
                }
                composable(BottomNavigationItem.PACK_OPENING.route) {
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
                composable(MORE_ROUTE) {
                    BottomNavigationMoreScreen(
                        destinations = overflowDestinations,
                        contentPadding = padding,
                        onDestination = ::navigateTo,
                    )
                }
                composable(CUSTOMIZE_NAVIGATION_ROUTE) {
                    BottomNavigationCustomizationScreen(
                        state = state,
                        contentPadding = padding,
                        viewModel = viewModel,
                        onBack = navController::popBackStack,
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
                composable("settings-pricing-sources") {
                    PricingSourceSettingsScreen(
                        repository = pricingSourceRepository,
                        preferenceStore = pricingSourceStore,
                        enabledGames = state.preferences.enabledGames.sorted(),
                        contentPadding = padding,
                    )
                }
                composable("settings-server-access") {
                    ServerAccessPolicyScreen(serverAccessRepository, padding)
                }
                composable("settings-finance-history") {
                    FinanceHistoryScreen(
                        repository = financeRepository,
                        enabledGames = state.preferences.enabledGames.sorted(),
                        defaultCurrency = state.preferences.currency,
                        contentPadding = padding,
                    )
                }
                composable(GAME_STORE_ROUTE) {
                    OfficialGameStoreScreen(
                        state = state.gamePackages,
                        enabledGames = state.preferences.enabledGames,
                        contentPadding = padding,
                        onRefresh = viewModel::refreshOfficialGamePackages,
                        onEnable = viewModel::installOfficialGamePackage,
                        onBack = navController::popBackStack,
                    )
                }
                composable(INSTALL_GAME_URL_ROUTE) {
                    InstallGamePackageScreen(
                        state = state.gamePackages,
                        contentPadding = padding,
                        onInstall = viewModel::installGamePackage,
                        onBack = navController::popBackStack,
                    )
                }
                composable("set-detail") {
                    selectedSet?.let { set ->
                        SetDetailScreen(
                            set = set,
                            dataSource = catalogSource,
                            ownedCards = ownedPrintings,
                            contentPadding = padding,
                            onBack = navController::popBackStack,
                            onCardSelected = ::openCatalogCard,
                            onAddSetToWishlist = ::addSetToWishlist,
                        )
                    }
                }
                composable("pokedex-species") {
                    selectedSpecies?.let { species ->
                        PokedexSpeciesDetailScreen(
                            species = species,
                            contentPadding = padding,
                            onBack = navController::popBackStack,
                            onCardSelected = ::openCatalogCard,
                        )
                    }
                }
                composable("guide-detail") {
                    selectedGuide?.let { guide ->
                        CollectionGuideDetailScreen(
                            initialGuide = guide,
                            dataSource = catalogSource,
                            contentPadding = padding,
                            onBack = navController::popBackStack,
                            onCardSelected = ::openCatalogCard,
                            onFollowed = { viewModel.refresh() },
                        )
                    }
                }
                composable("deck/{deckId}", arguments = listOf(navArgument("deckId") { type = NavType.StringType })) { entry ->
                    DeckDetailScreen(
                        controller = socialController,
                        deckId = entry.arguments?.getString("deckId").orEmpty(),
                        contentPadding = padding,
                        onBack = navController::popBackStack,
                    )
                }
                composable("trade/{tradeId}", arguments = listOf(navArgument("tradeId") { type = NavType.StringType })) { entry ->
                    TradeDetailScreen(
                        controller = socialController,
                        tradeId = entry.arguments?.getString("tradeId").orEmpty(),
                        contentPadding = padding,
                        onBack = navController::popBackStack,
                    )
                }
                composable("binder/{binderId}", arguments = listOf(navArgument("binderId") { type = NavType.StringType })) { entry ->
                    BinderDetailScreen(
                        binder = state.binders.firstOrNull { it.id == entry.arguments?.getString("binderId") },
                        contentPadding = padding,
                        showPricing = state.preferences.showPricing,
                        showCardNumbers = state.preferences.showCardNumbers,
                        currency = state.preferences.currency,
                        shareSiteUrl = state.preferences.serverUrl,
                        onBack = navController::popBackStack,
                        onRemove = viewModel::removeCard,
                        onUpdate = viewModel::updateBinder,
                        onLoadShareLinks = viewModel::getBinderShareLinks,
                        onCreateShareLink = viewModel::createBinderShareLink,
                        onRevokeShareLink = viewModel::revokeBinderShareLink,
                    )
                }
                composable("wishlist/{wishlistId}", arguments = listOf(navArgument("wishlistId") { type = NavType.StringType })) { entry ->
                    WishlistDetailScreen(
                        wishlist = state.wishlists.firstOrNull { it.id == entry.arguments?.getString("wishlistId") },
                        contentPadding = padding,
                        showCardNumbers = state.preferences.showCardNumbers,
                        onBack = navController::popBackStack,
                        onAddCards = { navController.navigate(BottomNavigationItem.SEARCH.route) },
                        onUpdate = viewModel::updateWishlist,
                        onRemoveCard = viewModel::removeWishlistCard,
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

private fun CatalogParityCard.toDomainCard() = CatalogCard(
    id = id,
    name = name,
    tcg = tcg,
    setCode = setCode,
    setName = setName,
    rarity = rarity,
    collectorNumber = collectorNumber,
    imageUrl = imageUrl ?: imageUrlSmall,
    exactPrintingId = id,
)
