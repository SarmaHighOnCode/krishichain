package com.krishichain.app.ui.verify.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.krishichain.app.data.model.LotRecordDto
import com.krishichain.app.domain.ChainVerdict
import com.krishichain.app.domain.Flags
import com.krishichain.app.domain.isBreaching
import com.krishichain.app.ui.theme.KrishiTheme
import com.krishichain.app.ui.theme.RadiusSm
import com.krishichain.app.ui.theme.Spacing
import java.text.DateFormat
import java.util.Date

/**
 * Kotlin/Compose port of `apps/web/components/JourneyTimeline.tsx` — one entry per reading,
 * collapsing long nominal runs so a 60+ record demo lot doesn't become a firehose. Every
 * genesis/final reading and every anomalous one (chain issue, flag, or cold-chain breach) is
 * always shown individually — same `MAX_VISIBLE`/`EDGE_COUNT` constants as the web version.
 *
 * KNOWN GAP (carried over from the web version's doc comment): `GET /lot/:lotId` returns sensor
 * readings only, no custody/handoff events — this renders what the API actually returns.
 */

private const val MAX_VISIBLE = 25
private const val EDGE_COUNT = 3

private fun isAnomalous(record: LotRecordDto): Boolean =
    record.verdict != ChainVerdict.ACCEPT || isBreaching(record) || (record.flags and Flags.LID_OPEN) != 0

private fun formatTimestamp(ts: String): String {
    val seconds = ts.toLongOrNull() ?: return "unsynced clock"
    if (seconds <= 0) return "unsynced clock"
    return DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(seconds * 1000))
}

private fun flagLabels(flags: Int): List<String> = buildList {
    if (flags and Flags.LID_OPEN != 0) add("LID OPEN")
    if (flags and Flags.SHOCK != 0) add("SHOCK")
    if (flags and Flags.SENSOR_FAULT != 0) add("SENSOR FAULT")
    if (flags and Flags.BUFFERED != 0) add("BUFFERED (offline)")
    if (flags and Flags.BOOT != 0) add("BOOT")
    if (flags and Flags.LOT_BOUND != 0) add("LOT BOUND")
    if (flags and Flags.CAL != 0) add("CALIBRATION")
}

private sealed interface Row {
    data class RecordRow(val record: LotRecordDto) : Row
    data class GapRow(val count: Int) : Row
}

private fun buildRows(records: List<LotRecordDto>): List<Row> {
    val keep = HashSet<Int>()
    records.forEachIndexed { index, record ->
        val edge = index < EDGE_COUNT || index >= records.size - EDGE_COUNT
        if (records.size <= MAX_VISIBLE || edge || isAnomalous(record)) keep.add(index)
    }

    val rows = mutableListOf<Row>()
    var collapsed = 0
    records.forEachIndexed { index, record ->
        if (index in keep) {
            if (collapsed > 0) {
                rows.add(Row.GapRow(collapsed))
                collapsed = 0
            }
            rows.add(Row.RecordRow(record))
        } else {
            collapsed += 1
        }
    }
    if (collapsed > 0) rows.add(Row.GapRow(collapsed))
    return rows
}

@Composable
fun JourneyTimeline(records: List<LotRecordDto>, modifier: Modifier = Modifier) {
    val colors = KrishiTheme.colors

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(RadiusSm))
            .padding(horizontal = Spacing.xl, vertical = Spacing.lg),
    ) {
        Text(
            text = "JOURNEY · ${records.size} READINGS",
            style = MaterialTheme.typography.labelMedium,
            color = colors.slateStrong,
        )
        Spacer(Modifier.height(Spacing.md))

        if (records.isEmpty()) {
            Text(
                text = "No readings recorded yet.",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.bodyMuted,
            )
            return@Column
        }

        // A plain Column, not a LazyColumn: this sits inside the verify screen's own scrolling
        // container (VerifyScreen.kt), and a lazy list can't be nested inside another scrollable
        // without a fixed height. Row counts here are small even for a 300-record demo lot once
        // collapsed (MAX_VISIBLE caps the interesting rows at 25 plus edges), so this is cheap.
        val rows = buildRows(records)
        Column(modifier = Modifier.fillMaxWidth()) {
            rows.forEach { row ->
                when (row) {
                    is Row.GapRow -> GapEntry(row.count)
                    is Row.RecordRow -> TimelineEntry(row.record)
                }
            }
        }
    }
}

@Composable
private fun GapEntry(count: Int) {
    val colors = KrishiTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = Spacing.lg, top = Spacing.xs, bottom = Spacing.xs),
    ) {
        Text(
            text = "⋮ $count nominal reading${if (count == 1) "" else "s"} collapsed",
            style = MaterialTheme.typography.labelSmall,
            color = colors.bodyMuted,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun TimelineEntry(record: LotRecordDto) {
    val colors = KrishiTheme.colors
    val breach = isBreaching(record)
    val anomalous = record.verdict != ChainVerdict.ACCEPT
    val flags = flagLabels(record.flags)
    val dotColor = when {
        anomalous -> colors.statusUnverifiable
        breach -> colors.statusFlagged
        else -> colors.statusVerified
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = Spacing.sm),
    ) {
        Box(
            modifier = Modifier
                .width(Spacing.lg)
                .padding(top = 4.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .background(dotColor, CircleShape),
            )
        }
        Column(modifier = Modifier.padding(start = Spacing.sm)) {
            Row(modifier = Modifier.fillMaxWidth()) {
                Text(
                    text = "seq ${record.seq}",
                    style = MaterialTheme.typography.labelMedium,
                    color = colors.ink,
                )
                Spacer(Modifier.width(Spacing.md))
                Text(
                    text = formatTimestamp(record.ts),
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.bodyMuted,
                )
            }
            Text(
                text = buildString {
                    append("%.1f".format(record.t / 10.0))
                    append("°C · ")
                    append("%.1f".format(record.h / 10.0))
                    append("% RH")
                    if (!record.anchored) append(" · not yet anchored")
                },
                style = MaterialTheme.typography.bodyMedium,
            )
            if (anomalous || flags.isNotEmpty()) {
                val detail = (if (anomalous) listOf(record.verdict) else emptyList()) + flags
                Text(
                    text = detail.joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.bodyMuted,
                )
            }
        }
    }
}
