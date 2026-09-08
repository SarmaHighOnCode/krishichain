package com.krishichain.app.ui

import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.krishichain.app.ui.verify.VerifyScreen

/**
 * Phase 1: a single route. This exists as a real `NavHost` — rather than `VerifyScreen()` called
 * straight from `MainActivity` — specifically so Phase 2 (GPS/IMU/BLE "virtual sensor node") can
 * add a second `composable("sensor-node") { SensorNodeScreen() }` destination plus a way to
 * navigate to it, without restructuring anything here.
 */
private object Routes {
    const val VERIFY = "verify"
}

@Composable
fun KrishiChainNavHost() {
    val navController = rememberNavController()
    NavHost(navController = navController, startDestination = Routes.VERIFY) {
        composable(Routes.VERIFY) { VerifyScreen() }
        // Phase 2: composable(Routes.SENSOR_NODE) { SensorNodeScreen() }
    }
}
