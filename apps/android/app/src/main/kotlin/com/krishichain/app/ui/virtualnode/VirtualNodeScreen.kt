package com.krishichain.app.ui.virtualnode

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.lifecycle.viewmodel.compose.viewModel
import com.krishichain.app.domain.Hex
import com.krishichain.app.ui.theme.KrishiTheme
import com.krishichain.app.ui.theme.Spacing
import com.krishichain.app.ui.verify.components.InlineBadge

/**
 * Ticket S2-13, Phase 2 of the phone build: turns the device into a real virtual sensor node
 * rather than just the read-only consumer verifier `VerifyScreen` is. Everything shown here is a
 * live state — commissioning result, current chain position, the actual HTTP outcome of the last
 * `/ingest`/`/companion` call — never a spinner masking a failure (CLAUDE.md invariant #5).
 *
 * No BLE peripheral advertising: there is no gateway consumer for a BLE proximity signal today,
 * and Android's peripheral/GATT-server APIs are not reliably demo-safe across manufacturers in
 * this ticket's timebox. See the ticket report for the fuller reasoning.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VirtualNodeScreen(viewModel: VirtualNodeViewModel = viewModel()) {
    val colors = KrishiTheme.colors

    val commissioned by viewModel.commissioned.collectAsState()
    val streaming by viewModel.streaming.collectAsState()
    val recordSeq by viewModel.recordSeq.collectAsState()
    val recordSendState by viewModel.recordSendState.collectAsState()
    val companionSendState by viewModel.companionSendState.collectAsState()
    val lotIdInput by viewModel.lotIdInput.collectAsState()
    val lotIdError by viewModel.lotIdError.collectAsState()
    val locationPermissionGranted by viewModel.locationPermissionGranted.collectAsState()

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions(),
    ) {
        viewModel.refreshLocationPermission()
    }

    LaunchedEffect(Unit) { viewModel.refreshLocationPermission() }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("Virtual sensor node", style = MaterialTheme.typography.headlineMedium) })
        },
    ) { innerPadding: PaddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(horizontal = Spacing.lg)
                .verticalScroll(rememberScrollState()),
        ) {
            Spacer(Modifier.height(Spacing.sm))

            Text("Device address", style = MaterialTheme.typography.bodySmall, color = colors.bodyMuted)
            Text(
                viewModel.address,
                style = MaterialTheme.typography.labelMedium.copy(fontFamily = FontFamily.Monospace),
                color = colors.ink,
            )

            Spacer(Modifier.height(Spacing.sm))
            if (commissioned) {
                InlineBadge("Commissioned", colors.statusVerifiedWash, colors.statusVerified)
            } else {
                InlineBadge("Not commissioned yet", colors.statusPendingWash, colors.statusPending)
            }

            Spacer(Modifier.height(Spacing.lg))

            OutlinedTextField(
                value = lotIdInput,
                onValueChange = viewModel::onLotIdChanged,
                label = { Text("Lot ID (optional)") },
                placeholder = { Text("0x" + "0".repeat(32)) },
                singleLine = true,
                isError = lotIdError != null,
                supportingText = {
                    Text(lotIdError ?: "Leave blank to send unbound (all-zero) records", color = colors.bodyMuted)
                },
                textStyle = MaterialTheme.typography.labelMedium.copy(fontFamily = FontFamily.Monospace),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(Spacing.lg))

            if (!locationPermissionGranted) {
                Text(
                    "Location permission is not granted — GPS companion attestations will be skipped.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.bodyMuted,
                )
                Spacer(Modifier.height(Spacing.sm))
                OutlinedButton(onClick = {
                    permissionLauncher.launch(
                        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
                    )
                }) {
                    Text("Grant location permission")
                }
                Spacer(Modifier.height(Spacing.lg))
            }

            Button(onClick = viewModel::toggleStreaming) {
                Text(if (streaming) "Stop streaming" else "Start streaming")
            }

            Spacer(Modifier.height(Spacing.lg))

            Row(modifier = Modifier.fillMaxWidth()) {
                Text("seq", style = MaterialTheme.typography.bodySmall, color = colors.bodyMuted)
                Spacer(Modifier.width(Spacing.xs))
                Text("$recordSeq", style = MaterialTheme.typography.labelMedium, color = colors.ink)
            }

            Spacer(Modifier.height(Spacing.md))
            Text("Last record", style = MaterialTheme.typography.bodySmall, color = colors.bodyMuted)
            RecordStatusRow(recordSendState, colors)

            Spacer(Modifier.height(Spacing.md))
            Text("Last GPS companion", style = MaterialTheme.typography.bodySmall, color = colors.bodyMuted)
            CompanionStatusRow(companionSendState, colors)

            Spacer(Modifier.height(Spacing.section))
        }
    }
}

@Composable
private fun RecordStatusRow(
    state: RecordSendState,
    colors: com.krishichain.app.ui.theme.KrishiExtendedColors,
) {
    when (state) {
        is RecordSendState.Idle -> Text("Not started", style = MaterialTheme.typography.bodyMedium, color = colors.bodyMuted)

        is RecordSendState.Sending -> InlineBadge("Sending…", colors.statusPendingWash, colors.statusPending)

        is RecordSendState.Accepted -> {
            InlineBadge("Accepted", colors.statusVerifiedWash, colors.statusVerified)
            Spacer(Modifier.height(Spacing.xs))
            Text("seq ${state.seq} · ${truncateHex(state.digest)}", style = MaterialTheme.typography.labelSmall, color = colors.slateStrong)
            state.warning?.let {
                Spacer(Modifier.height(Spacing.xs))
                Text(it, style = MaterialTheme.typography.bodySmall, color = colors.statusFlagged)
            }
        }

        is RecordSendState.Rejected -> {
            InlineBadge("Rejected", colors.statusUnverifiableWash, colors.statusUnverifiable)
            Spacer(Modifier.height(Spacing.xs))
            Text("seq ${state.seq}: ${state.reason}", style = MaterialTheme.typography.bodySmall, color = colors.statusUnverifiable)
        }

        is RecordSendState.RequestFailed -> {
            InlineBadge("Request failed", colors.statusUnverifiableWash, colors.statusUnverifiable)
            Spacer(Modifier.height(Spacing.xs))
            Text(state.message, style = MaterialTheme.typography.bodySmall, color = colors.statusUnverifiable)
        }
    }
}

@Composable
private fun CompanionStatusRow(state: CompanionSendState, colors: com.krishichain.app.ui.theme.KrishiExtendedColors) {
    when (state) {
        is CompanionSendState.Idle -> Text("Not sent yet", style = MaterialTheme.typography.bodyMedium, color = colors.bodyMuted)

        is CompanionSendState.Sent -> {
            InlineBadge("Sent", colors.statusVerifiedWash, colors.statusVerified)
            Spacer(Modifier.height(Spacing.xs))
            Text("companion seq ${state.seq}", style = MaterialTheme.typography.labelSmall, color = colors.slateStrong)
        }

        is CompanionSendState.Skipped -> {
            InlineBadge("Skipped", colors.statusPendingWash, colors.statusPending)
            Spacer(Modifier.height(Spacing.xs))
            Text(state.reason, style = MaterialTheme.typography.bodySmall, color = colors.bodyMuted)
        }

        is CompanionSendState.Failed -> {
            InlineBadge("Failed", colors.statusUnverifiableWash, colors.statusUnverifiable)
            Spacer(Modifier.height(Spacing.xs))
            Text(state.reason, style = MaterialTheme.typography.bodySmall, color = colors.statusUnverifiable)
        }
    }
}

/** Same truncation convention as `VerifyPanel.kt`'s private `truncateHex`. */
private fun truncateHex(hex: Hex): String =
    if (hex.length <= 20) hex else "${hex.take(10)}…${hex.takeLast(6)}"
