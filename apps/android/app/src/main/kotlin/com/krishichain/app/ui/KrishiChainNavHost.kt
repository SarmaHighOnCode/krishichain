package com.krishichain.app.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Dashboard
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.VerifiedUser
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.krishichain.app.ui.dashboard.DashboardScreen
import com.krishichain.app.ui.dashboard.DashboardViewModel
import com.krishichain.app.ui.placeholder.SettingsPlaceholder
import com.krishichain.app.ui.scan.ScanScreen
import com.krishichain.app.ui.theme.KrishiTheme
import com.krishichain.app.ui.verify.VerifyScreen
import com.krishichain.app.ui.verify.VerifyViewModel

/**
 * Main navigation host with bottom navigation bar (Stripe-style).
 *
 * Phase 1: four tabs — Verify (the main screen), Scan (QR → lot lookup), Dashboard (placeholder),
 * Settings (placeholder). The bottom nav uses Stripe's indigo primary for selected items.
 *
 * [VerifyViewModel] is hoisted here (not created inside `VerifyScreen`) so a QR scan can push a
 * lot ID into the same instance the Verify tab reads from, then switch tabs — no
 * SavedStateHandle plumbing between destinations.
 */

private data class NavItem(
    val route: String,
    val label: String,
    val icon: ImageVector,
)

private val NAV_ITEMS = listOf(
    NavItem("verify", "Verify", Icons.Rounded.VerifiedUser),
    NavItem("scan", "Scan", Icons.Rounded.QrCodeScanner),
    NavItem("dashboard", "Dashboard", Icons.Rounded.Dashboard),
    NavItem("settings", "Settings", Icons.Rounded.Settings),
)

@Composable
fun KrishiChainNavHost() {
    val navController = rememberNavController()
    val colors = KrishiTheme.colors
    val verifyViewModel: VerifyViewModel = viewModel()
    val dashboardViewModel: DashboardViewModel = viewModel()

    fun goToVerifyTab() {
        navController.navigate("verify") {
            popUpTo(navController.graph.findStartDestination().id) {
                saveState = true
            }
            launchSingleTop = true
            restoreState = true
        }
    }

    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = navBackStackEntry?.destination

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        topBar = {
            @OptIn(ExperimentalMaterial3Api::class)
            TopAppBar(
                title = {
                    val currentRoute = currentDestination?.route
                    val title = NAV_ITEMS.find { it.route == currentRoute }?.label ?: "KrishiChain"
                    Text(title, style = MaterialTheme.typography.titleMedium)
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = colors.ink,
                )
            )
        },
        bottomBar = {
            NavigationBar(
                containerColor = MaterialTheme.colorScheme.surface,
                contentColor = colors.ink,
                tonalElevation = 0.dp,
            ) {

                NAV_ITEMS.forEach { item ->
                    val selected = currentDestination?.hierarchy?.any { it.route == item.route } == true
                    NavigationBarItem(
                        icon = {
                            Icon(
                                imageVector = item.icon,
                                contentDescription = item.label,
                            )
                        },
                        label = {
                            Text(
                                text = item.label,
                                style = MaterialTheme.typography.labelSmall,
                            )
                        },
                        selected = selected,
                        onClick = {
                            navController.navigate(item.route) {
                                popUpTo(navController.graph.findStartDestination().id) {
                                    saveState = true
                                }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = MaterialTheme.colorScheme.primary,
                            selectedTextColor = MaterialTheme.colorScheme.primary,
                            unselectedIconColor = colors.bodyMuted,
                            unselectedTextColor = colors.bodyMuted,
                            indicatorColor = colors.actionBlue.copy(alpha = 0.3f),
                        ),
                    )
                }
            }
        },
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = "verify",
            modifier = Modifier.fillMaxSize().padding(innerPadding),
        ) {
            composable("verify") { VerifyScreen(verifyViewModel) }
            composable("scan") {
                ScanScreen(
                    onLotScanned = { lotId ->
                        verifyViewModel.loadLot(lotId)
                        goToVerifyTab()
                    },
                    onManualEntry = { goToVerifyTab() },
                )
            }
            composable("dashboard") { DashboardScreen(dashboardViewModel) }
            composable("settings") { SettingsPlaceholder() }
        }
    }
}
