package com.krishichain.app.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.krishichain.app.ui.theme.KrishiTheme
import com.krishichain.app.ui.verify.VerifyScreen
import com.krishichain.app.ui.virtualnode.VirtualNodeScreen

/**
 * Phase 1 was a single route. Phase 2 (the phone virtual sensor node, ticket S2-13) adds a
 * second destination and the minimal top-level switcher this doc comment used to say would slot
 * in here without restructuring anything — a plain `TabRow`, not a drawer or bottom nav, since
 * this is a two-screen demo app rather than a real product surface.
 */
private object Routes {
    const val VERIFY = "verify"
    const val SENSOR_NODE = "sensor-node"
}

private data class TopLevelTab(val route: String, val label: String)

private val TABS = listOf(
    TopLevelTab(Routes.VERIFY, "Verify"),
    TopLevelTab(Routes.SENSOR_NODE, "Sensor node"),
)

@Composable
fun KrishiChainNavHost() {
    val navController = rememberNavController()
    val colors = KrishiTheme.colors

    // statusBarsPadding(): this Column sits outside any Scaffold (which would normally handle the
    // inset via its own TopAppBar), and `enableEdgeToEdge()` (MainActivity) draws app content
    // behind the system status bar by default — without this, the TabRow renders under the
    // status bar icons AND the status bar swallows touches meant for the tabs.
    Column(modifier = Modifier.fillMaxSize().statusBarsPadding()) {
        val backStackEntry by navController.currentBackStackEntryAsState()
        val currentRoute = backStackEntry?.destination?.hierarchy?.firstOrNull()?.route

        TabRow(
            selectedTabIndex = TABS.indexOfFirst { it.route == currentRoute }.coerceAtLeast(0),
            contentColor = colors.ink,
        ) {
            TABS.forEach { tab ->
                Tab(
                    selected = tab.route == currentRoute,
                    onClick = {
                        navController.navigate(tab.route) {
                            popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                            launchSingleTop = true
                            restoreState = true
                        }
                    },
                    text = { Text(tab.label, style = MaterialTheme.typography.labelMedium) },
                )
            }
        }

        NavHost(navController = navController, startDestination = Routes.VERIFY) {
            composable(Routes.VERIFY) { VerifyScreen() }
            composable(Routes.SENSOR_NODE) { VirtualNodeScreen() }
        }
    }
}
