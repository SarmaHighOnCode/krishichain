package com.krishichain.app.ui.verify.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.krishichain.app.ui.theme.KrishiTheme
import com.krishichain.app.ui.theme.RadiusSm
import com.krishichain.app.ui.theme.Spacing
import com.krishichain.app.ui.verify.ProofUiState
import com.krishichain.app.ui.verify.VerifyRunState

/**
 * Kotlin/Compose port of `apps/web/components/VerifyPanel.tsx` — THE demo moment. Never talks to
 * the gateway; it only reads the anchor root from the public RPC and recomputes the Merkle path
 * locally (`VerifyViewModel.runVerification`). Renders the same three honest non-happy-path
 * states the web version does: pending anchor, not deployed, and (after a run) proof invalid —
 * none of which are errors to swallow, per CLAUDE.md invariant #5.
 */
@Composable
fun VerifyPanel(
    proofState: ProofUiState,
    verifyState: VerifyRunState,
    onVerifyClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = KrishiTheme.colors

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(RadiusSm))
            .padding(horizontal = Spacing.xl, vertical = Spacing.lg),
    ) {
        when (proofState) {
            is ProofUiState.Loading -> {
                Row {
                    CircularProgressIndicator(modifier = Modifier.height(16.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(Spacing.sm))
                    Text("Fetching inclusion proof…", style = MaterialTheme.typography.bodyMedium, color = colors.bodyMuted)
                }
            }

            // UNVERIFIABLE-adjacent state, not an error path: nothing to verify against yet.
            is ProofUiState.PendingAnchor -> {
                InlineBadge("Pending anchor", colors.statusPendingWash, colors.statusPending)
                Spacer(Modifier.height(Spacing.sm))
                Text(
                    "This record is not anchored yet — there is no inclusion proof to check. Batches close every 60 seconds, or force one early with POST /anchor/flush.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.bodyMuted,
                )
            }

            // Also a real, honestly-rendered state: the mechanism is correct, but there is
            // nothing on-chain yet for this network (or nothing configured), so nothing can be
            // independently verified. Never rendered as a fake green tick.
            is ProofUiState.NotDeployed -> {
                InlineBadge("Not deployed", colors.statusUnverifiableWash, colors.statusUnverifiable)
                Spacer(Modifier.height(Spacing.sm))
                Text(
                    "BatchAnchor is not deployed to ${proofState.network} yet — run ${proofState.deployCommand}. The proof is real, but there is no on-chain root to check it against, so it cannot be called verified.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.bodyMuted,
                )
            }

            is ProofUiState.Ready -> {
                Button(onClick = onVerifyClick, enabled = verifyState !is VerifyRunState.Checking) {
                    Text(if (verifyState is VerifyRunState.Checking) "Verifying…" else "Verify independently")
                }

                if (verifyState !is VerifyRunState.Idle) {
                    Spacer(Modifier.height(Spacing.md))

                    when (verifyState) {
                        is VerifyRunState.Checking -> InlineBadge("Checking…", colors.statusPendingWash, colors.statusPending)
                        is VerifyRunState.Verified -> InlineBadge("Proof valid", colors.statusVerifiedWash, colors.statusVerified)
                        is VerifyRunState.Failed -> InlineBadge("Proof invalid", colors.statusUnverifiableWash, colors.statusUnverifiable)
                        VerifyRunState.Idle -> Unit
                    }

                    val detail = when (verifyState) {
                        is VerifyRunState.Checking -> "reading the anchor root from the chain…"
                        is VerifyRunState.Verified -> verifyState.detail
                        is VerifyRunState.Failed -> verifyState.detail
                        VerifyRunState.Idle -> ""
                    }
                    Spacer(Modifier.height(Spacing.sm))
                    Text(detail, style = MaterialTheme.typography.bodyMedium, color = colors.bodyMuted)

                    val onChainRoot = when (verifyState) {
                        is VerifyRunState.Verified -> verifyState.onChainRoot
                        is VerifyRunState.Failed -> verifyState.onChainRoot
                        else -> null
                    }

                    Spacer(Modifier.height(Spacing.md))
                    HexRow(label = "Gateway said root:", value = truncateHex(proofState.proof.root), colors = colors)
                    HexRow(label = "Chain says root:", value = onChainRoot?.let { truncateHex(it) } ?: "—", colors = colors)
                }
            }
        }
    }
}

@Composable
private fun HexRow(label: String, value: String, colors: com.krishichain.app.ui.theme.KrishiExtendedColors) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = colors.bodyMuted)
        Spacer(Modifier.width(Spacing.xs))
        Text(value, style = MaterialTheme.typography.labelSmall, color = colors.slateStrong)
    }
}

private fun truncateHex(hex: String): String =
    if (hex.length <= 20) hex else "${hex.take(10)}…${hex.takeLast(6)}"
