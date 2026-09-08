package com.krishichain.app.ui.verify

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import com.krishichain.app.ui.common.dropShadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.krishichain.app.ui.theme.KrishiTheme
import com.krishichain.app.ui.theme.RadiusLg
import com.krishichain.app.ui.theme.RadiusPill
import com.krishichain.app.ui.theme.Spacing
import com.krishichain.app.ui.verify.components.BadgeChip
import com.krishichain.app.ui.verify.components.ColdChainChart
import com.krishichain.app.ui.verify.components.JourneyTimeline
import com.krishichain.app.ui.verify.components.VerifyPanel

@Composable
fun VerifyScreen(viewModel: VerifyViewModel) {
    val lotIdInput by viewModel.lotIdInput.collectAsState()
    val lotState by viewModel.lotState.collectAsState()
    val proofState by viewModel.proofState.collectAsState()
    val verifyState by viewModel.verifyState.collectAsState()
    val colors = KrishiTheme.colors
    var showLotInput by remember { mutableStateOf(false) }

    // Pastel horizontal gradient matching the web dashboard screenshot
    val heroGradient = Brush.horizontalGradient(
        colors = listOf(
            colors.heroGradientStart,
            colors.heroGradientMid1,
            colors.heroGradientMid2,
            colors.heroGradientEnd,
        ),
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .verticalScroll(rememberScrollState()),
    ) {
        // ── Full-width Hero ─────────────────────────────────
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(heroGradient)
                .padding(horizontal = Spacing.xl, vertical = 28.dp),
        ) {
            Column {
                Text(
                    "Lot journey",
                    style = MaterialTheme.typography.headlineLarge,
                    color = colors.ink,
                )

                Spacer(Modifier.height(Spacing.lg))

                when (val state = lotState) {
                    is LotUiState.Idle -> {}
                    is LotUiState.Loading -> {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                            color = colors.ink,
                        )
                    }
                    is LotUiState.NotFound -> {
                        Text(
                            "Lot not found",
                            style = MaterialTheme.typography.titleMedium,
                            color = colors.ink,
                        )
                    }
                    is LotUiState.NetworkError -> {
                        Text(
                            state.message,
                            style = MaterialTheme.typography.bodyMedium,
                            color = colors.statusFlagged,
                        )
                    }
                    is LotUiState.Loaded -> {
                        // Big stat numbers
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(48.dp),
                        ) {
                            Column {
                                Text(
                                    state.lot.recordCount.toString(),
                                    style = MaterialTheme.typography.displayLarge,
                                    color = colors.ink,
                                )
                                Text(
                                    "records",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = colors.ink.copy(alpha = 0.45f),
                                )
                            }
                            Column {
                                Text(
                                    state.anchoredCount.toString(),
                                    style = MaterialTheme.typography.displayLarge,
                                    color = colors.ink,
                                )
                                Text(
                                    "anchored",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = colors.ink.copy(alpha = 0.45f),
                                )
                            }
                        }

                        Spacer(Modifier.height(Spacing.md))

                        // Status pill
                        val statusText = when (state.status) {
                            com.krishichain.app.domain.VerificationStatus.VERIFIED -> "LIVE"
                            com.krishichain.app.domain.VerificationStatus.PENDING_ANCHOR -> "PENDING"
                            com.krishichain.app.domain.VerificationStatus.FLAGGED -> "FLAGGED"
                            com.krishichain.app.domain.VerificationStatus.UNVERIFIABLE -> "UNVERIFIABLE"
                        }
                        val statusColor = if (state.status == com.krishichain.app.domain.VerificationStatus.FLAGGED || state.status == com.krishichain.app.domain.VerificationStatus.UNVERIFIABLE) {
                            colors.statusFlagged
                        } else {
                            colors.statusVerified
                        }
                        Text(
                            "● $statusText",
                            style = MaterialTheme.typography.labelSmall,
                            color = statusColor,
                        )
                    }
                }

                Spacer(Modifier.height(Spacing.lg))

                // "Change lot" toggle
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(RadiusPill))
                        .clickable { showLotInput = !showLotInput }
                        .background(
                            Color.White.copy(alpha = 0.5f),
                            RoundedCornerShape(RadiusPill),
                        )
                        .padding(horizontal = Spacing.md, vertical = Spacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    Icon(
                        imageVector = Icons.Rounded.Edit,
                        contentDescription = "Change lot",
                        tint = colors.ink,
                        modifier = Modifier.size(14.dp),
                    )
                    Text(
                        if (showLotInput) "Hide" else "Change lot",
                        style = MaterialTheme.typography.labelSmall,
                        color = colors.ink,
                    )
                }

                // Collapsible lot ID input
                AnimatedVisibility(
                    visible = showLotInput,
                    enter = expandVertically(),
                    exit = shrinkVertically(),
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = Spacing.md),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        OutlinedTextField(
                            value = lotIdInput,
                            onValueChange = viewModel::onLotIdChanged,
                            label = { Text("Lot ID") },
                            singleLine = true,
                            textStyle = MaterialTheme.typography.labelMedium.copy(
                                fontFamily = FontFamily.Monospace,
                                color = colors.ink,
                            ),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedBorderColor = colors.ink.copy(alpha = 0.5f),
                                unfocusedBorderColor = colors.ink.copy(alpha = 0.2f),
                                focusedLabelColor = colors.ink.copy(alpha = 0.7f),
                                unfocusedLabelColor = colors.ink.copy(alpha = 0.5f),
                                cursorColor = colors.ink,
                            ),
                            modifier = Modifier.weight(1f),
                        )
                        Spacer(Modifier.width(Spacing.sm))
                        Button(
                            onClick = {
                                viewModel.loadLot(lotIdInput)
                                showLotInput = false
                            },
                            shape = RoundedCornerShape(RadiusPill),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = colors.ink,
                                contentColor = Color.White,
                            ),
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.Search,
                                    contentDescription = null,
                                    modifier = Modifier.size(16.dp),
                                )
                                Text("Load")
                            }
                        }
                    }
                }
            }
        }

        // ── Content below hero ────────────────────────────────────────
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = Spacing.md),
        ) {
            val state = lotState
            if (state is LotUiState.Loaded) {
                VerifyPanel(
                    proofState = proofState,
                    verifyState = verifyState,
                    onVerifyClick = viewModel::runVerification,
                )

                Spacer(Modifier.height(Spacing.xl))
                ColdChainChart(records = state.lot.records)

                Spacer(Modifier.height(Spacing.xl))
                JourneyTimeline(records = state.lot.records)

                // "Not deployed" warning at the bottom
                val currentProof = proofState
                if (currentProof is ProofUiState.NotDeployed) {
                    Spacer(Modifier.height(Spacing.lg))
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = Spacing.sm),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center,
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.Warning,
                            contentDescription = null,
                            tint = colors.bodyMuted,
                            modifier = Modifier.size(14.dp),
                        )
                        Spacer(Modifier.width(Spacing.xs))
                        Text(
                            "Contract not deployed to ${currentProof.network}",
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.bodyMuted,
                        )
                    }
                }

                Spacer(Modifier.height(Spacing.section))
            }
        }
    }
}
