package com.krishichain.app.ui.verify.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.LockOpen
import androidx.compose.material.icons.rounded.PowerSettingsNew
import androidx.compose.material.icons.rounded.SensorsOff
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material.icons.rounded.Vibration
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.krishichain.app.data.model.LotRecordDto
import com.krishichain.app.domain.ChainVerdict
import com.krishichain.app.domain.Flags
import com.krishichain.app.domain.isBreaching
import com.krishichain.app.ui.common.SectionCard
import com.krishichain.app.ui.theme.KrishiTheme
import com.krishichain.app.ui.theme.RadiusXs
import com.krishichain.app.ui.theme.Spacing
import java.text.DateFormat
import java.util.Date

/**
 * Kotlin/Compose port of `apps/web/components/JourneyTimeline.tsx` — one entry per reading,
 * collapsing long nominal runs so a 60+ record demo lot doesn't become a firehose. Every
 * genesis/final reading and every anomalous one (chain issue, flag, or cold-chain breach) is
 * always shown individually — same `MAX_VISIBLE`/`EDGE_COUNT` constants as the web version.
 *
 * UI redesign: vertical connector line between dots, larger dots (10dp) with glow rings,
 * Material Icons for flag types, alternating row tints, and a styled gap indicator.
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

private data class FlagEntry(val label: String, val icon: ImageVector)

private fun flagEntries(flags: Int): List<FlagEntry> = buildList {
    if (flags and Flags.LID_OPEN != 0) add(FlagEntry("LID OPEN", Icons.Rounded.LockOpen))
    if (flags and Flags.SHOCK != 0) add(FlagEntry("SHOCK", Icons.Rounded.Vibration))
    if (flags and Flags.SENSOR_FAULT != 0) add(FlagEntry("SENSOR FAULT", Icons.Rounded.SensorsOff))
    if (flags and Flags.BUFFERED != 0) add(FlagEntry("BUFFERED (offline)", Icons.Rounded.CloudOff))
    if (flags and Flags.BOOT != 0) add(FlagEntry("BOOT", Icons.Rounded.PowerSettingsNew))
    if (flags and Flags.LOT_BOUND != 0) add(FlagEntry("LOT BOUND", Icons.Rounded.Tune))
    if (flags and Flags.CAL != 0) add(FlagEntry("CALIBRATION", Icons.Rounded.Tune))
}

private sealed interface TimelineRow {
    data class RecordRow(val record: LotRecordDto) : TimelineRow
    data class GapRow(val count: Int) : TimelineRow
}

private fun buildRows(records: List<LotRecordDto>): List<TimelineRow> {
    val keep = HashSet<Int>()
    records.forEachIndexed { index, record ->
        val edge = index < EDGE_COUNT || index >= records.size - EDGE_COUNT
        if (records.size <= MAX_VISIBLE || edge || isAnomalous(record)) keep.add(index)
    }

    val rows = mutableListOf<TimelineRow>()
    var collapsed = 0
    records.forEachIndexed { index, record ->
        if (index in keep) {
            if (collapsed > 0) {
                rows.add(TimelineRow.GapRow(collapsed))
                collapsed = 0
            }
            rows.add(TimelineRow.RecordRow(record))
        } else {
            collapsed += 1
        }
    }
    if (collapsed > 0) rows.add(TimelineRow.GapRow(collapsed))
    return rows
}

@Composable
fun JourneyTimeline(records: List<LotRecordDto>, modifier: Modifier = Modifier) {
    val colors = KrishiTheme.colors

    SectionCard(modifier = modifier) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(bottom = com.krishichain.app.ui.theme.Spacing.md)
            ) {
                androidx.compose.foundation.layout.Box(
                    modifier = Modifier
                        .size(24.dp)
                        .clip(androidx.compose.foundation.shape.RoundedCornerShape(6.dp))
                        .background(colors.cardAccentPurple)
                )
                Spacer(Modifier.width(12.dp))
                Text("Journey", style = MaterialTheme.typography.titleLarge, color = colors.slateStrong)
                Spacer(Modifier.weight(1f))
                Text(
                    "${records.size} stops",
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.bodyMuted,
                )
            }
            androidx.compose.material3.HorizontalDivider(color = colors.ink.copy(alpha = 0.05f))
            Spacer(Modifier.height(com.krishichain.app.ui.theme.Spacing.lg))

            if (records.isEmpty()) {
                Text(
                    text = "No readings recorded yet.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.bodyMuted,
                )
                return@Column
            }

            // The flat list of journey events
            Column(modifier = Modifier.fillMaxWidth()) {
                val rows = buildRows(records)
                rows.forEachIndexed { index, row ->
                    val isLast = index == rows.lastIndex
                    val showAlternate = index % 2 == 1
                    when (row) {
                        is TimelineRow.GapRow -> GapEntry(row.count)
                        is TimelineRow.RecordRow -> TimelineEntry(
                            record = row.record,
                            isLast = isLast,
                            alternateBackground = showAlternate,
                        )
                    }
                    // Inset separator with open ends (skip after last item)
                    if (!isLast) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(start = 44.dp, end = 16.dp)
                                .height(1.dp)
                                .background(colors.hairline.copy(alpha = 0.4f))
                        )
                    }
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
            .height(48.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Continuous dashed line
        Box(
            modifier = Modifier
                .width(28.dp)
                .fillMaxHeight()
                .drawBehind {
                    val centerX = size.width / 2
                    drawLine(
                        color = colors.hairline,
                        start = Offset(centerX, 0f),
                        end = Offset(centerX, size.height),
                        strokeWidth = 1.5f,
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(4f, 4f)),
                    )
                },
        )
        Spacer(Modifier.width(Spacing.md))
        Text(
            text = "$count more",
            style = MaterialTheme.typography.labelSmall,
            color = colors.bodyMuted,
        )
    }
}

@Composable
private fun TimelineEntry(
    record: LotRecordDto,
    isLast: Boolean,
    alternateBackground: Boolean,
) {
    val colors = KrishiTheme.colors
    val breach = isBreaching(record)
    val anomalous = record.verdict != ChainVerdict.ACCEPT
    val flags = flagEntries(record.flags)
    val dotColor = when {
        anomalous -> colors.statusUnverifiable
        breach -> colors.statusFlagged
        else -> colors.statusVerified
    }
    val connectorColor = colors.hairline

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 12.dp),
    ) {
        // Timeline connector + dot — full-height line with dot centered at top
        Box(
            modifier = Modifier
                .width(28.dp)
                .fillMaxHeight()
                .drawBehind {
                    val centerX = size.width / 2
                    // Line from top to bottom (continuous)
                    if (!isLast) {
                        drawLine(
                            color = connectorColor,
                            start = Offset(centerX, 0f),
                            end = Offset(centerX, size.height),
                            strokeWidth = 1.5f,
                        )
                    }
                },
            contentAlignment = Alignment.TopCenter,
        ) {
            // Simple dot
            Box(
                modifier = Modifier
                    .padding(top = 4.dp)
                    .size(10.dp)
                    .background(dotColor, CircleShape),
            )
        }

        Spacer(Modifier.width(Spacing.sm))

        // Content — two rows for better spacing/hierarchy
        Column(modifier = Modifier.weight(1f)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Main metric (temp)
                Text(
                    text = "${"%.1f".format(record.t / 10.0)}°C",
                    style = MaterialTheme.typography.titleMedium,
                    color = colors.ink,
                )
                // Timestamp
                Text(
                    text = formatTimestamp(record.ts),
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.bodyMuted,
                )
            }
            Spacer(Modifier.height(4.dp))
            Text(
                text = "Seq #${record.seq}  ·  ${"%.1f".format(record.h / 10.0)}% RH",
                style = MaterialTheme.typography.bodySmall,
                color = colors.bodyMuted,
            )
            // Only show flags if anomalous — keep it minimal
            if (anomalous || flags.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Row(
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (anomalous) {
                        Text(
                            text = record.verdict,
                            style = MaterialTheme.typography.labelSmall,
                            color = colors.statusUnverifiable,
                        )
                    }
                    flags.forEach { flag ->
                        Icon(
                            imageVector = flag.icon,
                            contentDescription = flag.label,
                            tint = if (breach || anomalous) colors.statusFlagged else colors.bodyMuted,
                            modifier = Modifier.size(14.dp),
                        )
                    }
                }
            }
        }
    }
}

