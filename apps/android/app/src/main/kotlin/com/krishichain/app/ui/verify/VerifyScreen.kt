package com.krishichain.app.ui.verify

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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.krishichain.app.ui.theme.KrishiTheme
import com.krishichain.app.ui.theme.Spacing
import com.krishichain.app.ui.verify.components.BadgeChip
import com.krishichain.app.ui.verify.components.ColdChainChart
import com.krishichain.app.ui.verify.components.JourneyTimeline
import com.krishichain.app.ui.verify.components.VerifyPanel

/**
 * Kotlin/Compose port of `apps/web/app/verify/[lotId]/page.tsx` — the single highest-value
 * screen in the project (docs/DEMO-SCRIPT.md, 1:15). The journey renders before verification
 * finishes; verification is progressive enhancement here exactly like the web version, never a
 * blocking spinner that white-screens the page on an RPC hiccup.
 *
 * The web page gets `lotId` from the Next.js route (`/verify/[lotId]`); this screen has no
 * server-side routing, so it's a text field defaulting to the same demo lot
 * `scripts/sim-node.ts` seeds (see `DEFAULT_LOT_ID`).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VerifyScreen(viewModel: VerifyViewModel = viewModel()) {
    val lotIdInput by viewModel.lotIdInput.collectAsState()
    val lotState by viewModel.lotState.collectAsState()
    val proofState by viewModel.proofState.collectAsState()
    val verifyState by viewModel.verifyState.collectAsState()
    val colors = KrishiTheme.colors

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Lot journey", style = MaterialTheme.typography.headlineMedium) },
            )
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

            Row(modifier = Modifier.fillMaxWidth()) {
                OutlinedTextField(
                    value = lotIdInput,
                    onValueChange = viewModel::onLotIdChanged,
                    label = { Text("Lot ID") },
                    singleLine = true,
                    textStyle = MaterialTheme.typography.labelMedium.copy(fontFamily = FontFamily.Monospace),
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(Spacing.sm))
                Button(onClick = { viewModel.loadLot(lotIdInput) }) {
                    Text("Load")
                }
            }

            Spacer(Modifier.height(Spacing.lg))

            when (val state = lotState) {
                is LotUiState.Idle -> Unit

                is LotUiState.Loading -> {
                    Row {
                        CircularProgressIndicator(modifier = Modifier.height(20.dp))
                        Spacer(Modifier.width(Spacing.sm))
                        Text("Loading lot…", style = MaterialTheme.typography.bodyMedium, color = colors.bodyMuted)
                    }
                }

                is LotUiState.NotFound -> {
                    Text("Lot not found", style = MaterialTheme.typography.headlineMedium)
                    Spacer(Modifier.height(Spacing.xs))
                    Text(
                        "Nothing recorded for ${state.lotId}. Is the gateway running? Try npm run sim.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.bodyMuted,
                    )
                }

                is LotUiState.NetworkError -> {
                    Text("Could not load this lot", style = MaterialTheme.typography.headlineMedium)
                    Spacer(Modifier.height(Spacing.xs))
                    Text(state.message, style = MaterialTheme.typography.bodyMedium, color = colors.statusUnverifiable)
                }

                is LotUiState.Loaded -> {
                    Text(state.lot.lotId, style = MaterialTheme.typography.labelMedium, color = colors.bodyMuted)
                    Spacer(Modifier.height(Spacing.sm))
                    BadgeChip(state.status)
                    Spacer(Modifier.height(Spacing.xs))
                    Text(
                        "${state.lot.recordCount} records · ${state.anchoredCount} anchored",
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.bodyMuted,
                    )

                    Spacer(Modifier.height(Spacing.lg))
                    VerifyPanel(
                        proofState = proofState,
                        verifyState = verifyState,
                        onVerifyClick = viewModel::runVerification,
                    )

                    Spacer(Modifier.height(Spacing.lg))
                    ColdChainChart(records = state.lot.records)

                    Spacer(Modifier.height(Spacing.lg))
                    JourneyTimeline(records = state.lot.records)

                    Spacer(Modifier.height(Spacing.section))
                }
            }
        }
    }
}
