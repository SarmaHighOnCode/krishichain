package com.krishichain.app.ui.verify.components

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Cancel
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.krishichain.app.ui.common.SectionCard
import com.krishichain.app.ui.theme.KrishiTheme
import com.krishichain.app.ui.theme.RadiusPill
import com.krishichain.app.ui.theme.RadiusXs
import com.krishichain.app.ui.theme.Spacing
import com.krishichain.app.ui.verify.ProofUiState
import com.krishichain.app.ui.verify.VerifyRunState

/**
 * Kotlin/Compose port of `apps/web/components/VerifyPanel.tsx` — THE demo moment. Never talks to
 * the gateway; it only reads the anchor root from the public RPC and recomputes the Merkle path
 * locally (`VerifyViewModel.runVerification`). Renders the same three honest non-happy-path
 * states the web version does: pending anchor, not deployed, and (after a run) proof invalid —
 * none of which are errors to swallow, per CLAUDE.md invariant #5.
 *
 * UI redesign: full-width pill CTA, AnimatedContent state transitions, styled root comparison
 * cards, Material icons for inline badges.
 */
@Composable
fun VerifyPanel(
    proofState: ProofUiState,
    verifyState: VerifyRunState,
    onVerifyClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = KrishiTheme.colors
    
    if (proofState is ProofUiState.NotDeployed) {
        // Handled in VerifyScreen — rendered at the bottom of the page
        return
    }

    SectionCard(modifier = modifier, accentColor = colors.cardAccentPurple, elevated = true) {
        Column(modifier = Modifier.fillMaxWidth()) {
            when (proofState) {
                is ProofUiState.Loading -> {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.primary,
                        )
                        Text(
                            "Fetching inclusion proof…",
                            style = MaterialTheme.typography.bodyMedium,
                            color = colors.bodyMuted,
                        )
                    }
                }

                // UNVERIFIABLE-adjacent state, not an error path: nothing to verify against yet.
                is ProofUiState.PendingAnchor -> {
                    InlineBadge(
                        "Pending anchor",
                        colors.statusPendingWash,
                        colors.statusPending,
                        icon = Icons.Rounded.Schedule,
                    )
                    Spacer(Modifier.height(Spacing.sm))
                    Text(
                        "This record is not anchored yet — there is no inclusion proof to check. Batches close every 60 seconds, or force one early with POST /anchor/flush.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.bodyMuted,
                    )
                }
                
                is ProofUiState.NotDeployed -> {
                    // Handled above, this block will never be reached but keeps the compiler happy if when is exhaustive
                }

                is ProofUiState.Ready -> {
                    // Full-width pill CTA — THE demo moment
                    Button(
                        onClick = onVerifyClick,
                        enabled = verifyState !is VerifyRunState.Checking,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(RadiusPill),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.primary,
                            contentColor = colors.onPrimary,
                        ),
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                        ) {
                            if (verifyState is VerifyRunState.Checking) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(16.dp),
                                    strokeWidth = 2.dp,
                                    color = colors.onPrimary,
                                )
                            } else {
                                Icon(
                                    imageVector = Icons.Rounded.Shield,
                                    contentDescription = null,
                                    modifier = Modifier.size(18.dp),
                                )
                            }
                            Text(
                                if (verifyState is VerifyRunState.Checking) "Verifying…" else "Verify independently",
                                style = MaterialTheme.typography.labelLarge,
                            )
                        }
                    }

                    // Animated verification result
                    AnimatedContent(
                        targetState = verifyState,
                        transitionSpec = { fadeIn() togetherWith fadeOut() },
                        label = "verify-result",
                    ) { currentState ->
                        when (currentState) {
                            is VerifyRunState.Idle -> {}

                            is VerifyRunState.Checking -> {
                                Column(modifier = Modifier.padding(top = Spacing.md)) {
                                    InlineBadge(
                                        "Checking…",
                                        colors.statusPendingWash,
                                        colors.statusPending,
                                        icon = Icons.Rounded.Schedule,
                                    )
                                    Spacer(Modifier.height(Spacing.sm))
                                    Text(
                                        "Reading the anchor root from the chain…",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = colors.bodyMuted,
                                    )
                                }
                            }

                            is VerifyRunState.Verified -> {
                                Column(modifier = Modifier.padding(top = Spacing.md)) {
                                    InlineBadge(
                                        "Proof valid",
                                        colors.statusVerifiedWash,
                                        colors.statusVerified,
                                        icon = Icons.Rounded.CheckCircle,
                                    )
                                    Spacer(Modifier.height(Spacing.sm))
                                    Text(
                                        currentState.detail,
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = colors.bodyMuted,
                                    )
                                    Spacer(Modifier.height(Spacing.md))
                                    RootComparisonCard(
                                        gatewayRoot = truncateHex(proofState.proof.root),
                                        chainRoot = truncateHex(currentState.onChainRoot),
                                        match = true,
                                    )
                                }
                            }

                            is VerifyRunState.Failed -> {
                                Column(modifier = Modifier.padding(top = Spacing.md)) {
                                    InlineBadge(
                                        "Proof invalid",
                                        colors.statusUnverifiableWash,
                                        colors.statusUnverifiable,
                                        icon = Icons.Rounded.Cancel,
                                    )
                                    Spacer(Modifier.height(Spacing.sm))
                                    Text(
                                        currentState.detail,
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = colors.bodyMuted,
                                    )
                                    Spacer(Modifier.height(Spacing.md))
                                    RootComparisonCard(
                                        gatewayRoot = truncateHex(proofState.proof.root),
                                        chainRoot = currentState.onChainRoot?.let { truncateHex(it) } ?: "—",
                                        match = false,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Side-by-side root comparison card with status-colored left border —
 * green if the roots match, red if they don't.
 */
@Composable
private fun RootComparisonCard(gatewayRoot: String, chainRoot: String, match: Boolean) {
    val colors = KrishiTheme.colors
    val borderColor = if (match) colors.statusVerified else colors.statusUnverifiable
    val shape = RoundedCornerShape(RadiusXs)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, borderColor.copy(alpha = 0.3f), shape)
            .background(
                if (match) colors.statusVerifiedWash.copy(alpha = 0.3f)
                else colors.statusUnverifiableWash.copy(alpha = 0.3f),
                shape,
            )
            .padding(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        HexRow(label = "Gateway said root:", value = gatewayRoot, colors = colors)
        HexRow(label = "Chain says root:", value = chainRoot, colors = colors)
    }
}

@Composable
private fun HexRow(label: String, value: String, colors: com.krishichain.app.ui.theme.KrishiExtendedColors) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = colors.bodyMuted)
        Spacer(Modifier.width(Spacing.xs))
        Text(value, style = MaterialTheme.typography.labelSmall, color = colors.slateStrong)
    }
}

private fun truncateHex(hex: String): String =
    if (hex.length <= 20) hex else "${hex.take(10)}…${hex.takeLast(6)}"

