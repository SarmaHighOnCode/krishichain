package com.krishichain.app.ui.placeholder

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Dashboard
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.krishichain.app.ui.theme.KrishiTheme
import com.krishichain.app.ui.theme.Spacing

/**
 * Placeholder screens for Dashboard and Settings tabs — will be replaced with
 * real content in future phases.
 */

@Composable
fun DashboardPlaceholder() {
    val colors = KrishiTheme.colors
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Icon(
                imageVector = Icons.Rounded.Dashboard,
                contentDescription = null,
                tint = colors.actionBlue,
                modifier = Modifier.size(48.dp),
            )
            Spacer(Modifier.height(Spacing.lg))
            Text(
                "Ops Dashboard",
                style = MaterialTheme.typography.headlineMedium,
                color = colors.ink,
            )
            Spacer(Modifier.height(Spacing.sm))
            Text(
                "Coming in Phase 2",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.bodyMuted,
            )
        }
    }
}

@Composable
fun SettingsPlaceholder() {
    val colors = KrishiTheme.colors
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Icon(
                imageVector = Icons.Rounded.Settings,
                contentDescription = null,
                tint = colors.actionBlue,
                modifier = Modifier.size(48.dp),
            )
            Spacer(Modifier.height(Spacing.lg))
            Text(
                "Settings",
                style = MaterialTheme.typography.headlineMedium,
                color = colors.ink,
            )
            Spacer(Modifier.height(Spacing.sm))
            Text(
                "Gateway URL, chain config, and preferences",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.bodyMuted,
            )
        }
    }
}
