package com.krishichain.app.ui.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.krishichain.app.ui.common.SectionCard
import com.krishichain.app.ui.theme.KrishiTheme
import com.krishichain.app.ui.theme.RadiusLg
import com.krishichain.app.ui.theme.Spacing
import kotlinx.coroutines.delay

@Composable
fun DashboardScreen(
    viewModel: DashboardViewModel,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()
    val colors = KrishiTheme.colors

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .windowInsetsPadding(WindowInsets.statusBars)
            .verticalScroll(rememberScrollState())
            .padding(Spacing.xl)
    ) {
        Text(
            text = "Ops dashboard",
            style = MaterialTheme.typography.displayMedium,
            color = colors.ink
        )
        
        Spacer(Modifier.height(Spacing.xl))

        when (val state = uiState) {
            is DashboardUiState.Loading -> {
                Text("Connecting to gateway...", color = colors.bodyMuted)
            }
            is DashboardUiState.Live -> {
                DashboardContent(state.summary, state.lastUpdatedMs, true)
            }
            is DashboardUiState.Reconnecting -> {
                if (state.lastSummary != null) {
                    DashboardContent(state.lastSummary, state.lastUpdatedMs, false)
                } else {
                    Text("Gateway unreachable. Is it running? Retrying...", color = colors.bodyMuted)
                }
            }
        }
    }
}

@Composable
private fun DashboardContent(
    summary: com.krishichain.app.data.model.OpsSummaryDto,
    lastUpdatedMs: Long?,
    isLive: Boolean
) {
    val colors = KrishiTheme.colors
    
    // Ticker for "updated Xs ago"
    var tick by remember { mutableStateOf(0) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(1000)
            tick++
        }
    }

    val secondsAgo = if (lastUpdatedMs != null) {
        maxOf(0, (System.currentTimeMillis() - lastUpdatedMs) / 1000)
    } else null

    // Status Line
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        modifier = Modifier.padding(bottom = Spacing.lg)
    ) {
        val badgeBg = if (isLive) colors.statusVerifiedWash else colors.statusFlaggedWash
        val badgeFg = if (isLive) colors.statusVerified else colors.statusFlagged
        val label = if (isLive) "live" else "reconnecting…"
        
        Box(
            modifier = Modifier
                .background(badgeBg, RoundedCornerShape(100))
                .padding(horizontal = 8.dp, vertical = 2.dp)
        ) {
            Text(label, style = MaterialTheme.typography.labelSmall, color = badgeFg)
        }
        
        val timeText = when {
            secondsAgo == null -> "waiting for first update…"
            secondsAgo <= 1 -> "updated just now"
            else -> "updated ${secondsAgo}s ago"
        }
        Text(
            text = timeText,
            style = MaterialTheme.typography.bodySmall,
            color = colors.bodyMuted
        )
    }

    // Grid of Stats
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            StatCard(
                label = "Records ingested",
                value = summary.records.toString(),
                modifier = Modifier.weight(1f)
            )
            StatCard(
                label = "Quarantined",
                value = summary.quarantined.toString(),
                emphasis = if (summary.quarantined > 0) "bad" else null,
                modifier = Modifier.weight(1f)
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            StatCard(
                label = "Batches closed",
                value = summary.batches.toString(),
                modifier = Modifier.weight(1f)
            )
            StatCard(
                label = "Pending leaves",
                value = summary.pendingLeaves.toString(),
                modifier = Modifier.weight(1f)
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            StatCard(
                label = "Incidents",
                value = summary.incidents.toString(),
                emphasis = if (summary.incidents > 0) "flagged" else null,
                modifier = Modifier.weight(1f)
            )
            Spacer(modifier = Modifier.weight(1f))
        }
    }

    Spacer(Modifier.height(Spacing.lg))

    // Last anchored root
    SectionCard(accentColor = colors.cardAccentPurple) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Text(
                "Last anchored root",
                style = MaterialTheme.typography.labelSmall,
                color = colors.bodyMuted
            )
            Spacer(Modifier.height(Spacing.sm))
            
            if (summary.lastRoot == "0x0000000000000000000000000000000000000000000000000000000000000000") {
                Box(
                    modifier = Modifier
                        .background(colors.statusPendingWash, RoundedCornerShape(100))
                        .padding(horizontal = 8.dp, vertical = 2.dp)
                ) {
                    Text("none anchored yet", style = MaterialTheme.typography.labelSmall, color = colors.statusPending)
                }
            } else {
                Text(
                    summary.lastRoot,
                    style = MaterialTheme.typography.bodyMedium.copy(fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace),
                    color = colors.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
    
    Spacer(Modifier.height(Spacing.lg))
    
    // Node health stub
    SectionCard(accentColor = colors.cardAccentNavy) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Text(
                "Node health",
                style = MaterialTheme.typography.labelSmall,
                color = colors.bodyMuted
            )
            Spacer(Modifier.height(Spacing.sm))
            Text(
                "Per-device last-seen and buffer depth aren't available yet — the gateway only exposes aggregate counts via GET /ops/summary.",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.bodyMuted
            )
        }
    }
    
    Spacer(Modifier.height(Spacing.section))
}

@Composable
private fun StatCard(
    label: String,
    value: String,
    emphasis: String? = null,
    modifier: Modifier = Modifier
) {
    val colors = KrishiTheme.colors
    val valueColor = when (emphasis) {
        "bad" -> colors.statusUnverifiable
        "flagged" -> colors.statusFlagged
        else -> colors.ink
    }

    SectionCard(modifier = modifier, elevated = true) {
        Column {
            Text(
                text = label.uppercase(),
                style = MaterialTheme.typography.labelSmall,
                color = colors.bodyMuted
            )
            Spacer(Modifier.height(Spacing.xs))
            Text(
                text = value,
                style = MaterialTheme.typography.displayMedium,
                color = valueColor
            )
            if (emphasis != null) {
                Spacer(Modifier.height(Spacing.sm))
                val badgeBg = if (emphasis == "bad") colors.statusUnverifiableWash else colors.statusFlaggedWash
                Box(
                    modifier = Modifier
                        .background(badgeBg, RoundedCornerShape(100))
                        .padding(horizontal = 8.dp, vertical = 2.dp)
                ) {
                    Text("needs attention", style = MaterialTheme.typography.labelSmall, color = valueColor)
                }
            }
        }
    }
}
