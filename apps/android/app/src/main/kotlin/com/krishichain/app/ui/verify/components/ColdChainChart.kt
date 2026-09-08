package com.krishichain.app.ui.verify.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.krishichain.app.data.model.LotRecordDto
import com.krishichain.app.domain.DEFAULT_TEMP_MAX_C
import com.krishichain.app.domain.deriveIncidents
import com.krishichain.app.ui.theme.KrishiTheme
import com.krishichain.app.ui.theme.RadiusSm
import com.krishichain.app.ui.theme.Spacing
import kotlin.math.max
import kotlin.math.min

/**
 * Kotlin/Compose port of `apps/web/components/ColdChainChart.tsx` — a hand-drawn line chart (a
 * Compose `Canvas`, same reasoning as the web version's hand-drawn inline SVG: one series doesn't
 * earn a charting library dependency), plotting `record.t` (deci-C) over sequence, with the
 * breach window shaded and a dashed threshold line at `tempMaxC`.
 *
 * Breach detection comes from `domain/Incidents.kt` — the same function `Badge.kt` and
 * `JourneyTimeline.kt` use — so the chart, badge, and timeline can never disagree.
 */
@Composable
fun ColdChainChart(
    records: List<LotRecordDto>,
    tempMaxC: Int = DEFAULT_TEMP_MAX_C,
    modifier: Modifier = Modifier,
) {
    if (records.isEmpty()) return

    val colors = KrishiTheme.colors
    val incidents = deriveIncidents(records, tempMaxC)

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(RadiusSm))
            .padding(horizontal = Spacing.xl, vertical = Spacing.lg),
    ) {
        Text(
            text = "TEMPERATURE · ${records.size} READINGS",
            style = MaterialTheme.typography.labelMedium,
            color = colors.slateStrong,
        )
        androidx.compose.foundation.layout.Spacer(Modifier.height(Spacing.sm))

        val description = if (incidents.breached) {
            "Temperature chart with a cold-chain breach shaded from seq ${incidents.breachStart} to ${incidents.breachEnd}"
        } else {
            "Temperature chart, no cold-chain breach"
        }

        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .height(160.dp)
                .semantics { contentDescription = description },
        ) {
            val padX = 8.dp.toPx()
            val padY = 16.dp.toPx()
            val innerWidth = size.width - padX * 2
            val innerHeight = size.height - padY * 2

            val temps = records.map { it.t / 10.0 }
            val minTemp = min(temps.min(), tempMaxC.toDouble())
            val maxTemp = max(temps.max(), tempMaxC.toDouble())
            val range = (maxTemp - minTemp).let { if (it == 0.0) 1.0 else it }

            fun xFor(index: Int): Float = if (records.size == 1) {
                padX + innerWidth / 2
            } else {
                padX + (index.toFloat() / (records.size - 1)) * innerWidth
            }

            fun yFor(tempC: Double): Float =
                (padY + innerHeight - ((tempC - minTemp) / range) * innerHeight).toFloat()

            // Breach window shading.
            if (incidents.breached && incidents.breachStart != null && incidents.breachEnd != null) {
                val indexBySeq = records.withIndex().associate { (i, r) -> r.seq to i }
                val x1 = xFor(indexBySeq[incidents.breachStart] ?: 0)
                val x2 = xFor(indexBySeq[incidents.breachEnd] ?: (records.size - 1))
                val left = min(x1, x2) - 3f
                val width = max(x2 - x1, 0f) + 6f
                drawRect(
                    color = colors.statusFlaggedWash,
                    topLeft = Offset(left, padY),
                    size = androidx.compose.ui.geometry.Size(width.coerceAtLeast(6f), innerHeight),
                )
            }

            // Dashed threshold line.
            val thresholdY = yFor(tempMaxC.toDouble())
            drawLine(
                color = colors.hairline,
                start = Offset(padX, thresholdY),
                end = Offset(size.width - padX, thresholdY),
                strokeWidth = 1.dp.toPx(),
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f, 8f), 0f),
            )

            // Temperature line.
            val path = androidx.compose.ui.graphics.Path()
            records.forEachIndexed { index, record ->
                val x = xFor(index)
                val y = yFor(record.t / 10.0)
                if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
            }
            drawPath(
                path = path,
                color = if (incidents.breached) colors.statusFlagged else colors.statusVerified,
                style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round, join = androidx.compose.ui.graphics.StrokeJoin.Round),
            )
        }

        androidx.compose.foundation.layout.Spacer(Modifier.height(Spacing.sm))
        Text(
            text = buildString {
                append("Dashed line marks the $tempMaxC°C cold-chain threshold.")
                if (incidents.breached) {
                    append(" Breach shaded from seq ${incidents.breachStart} to ${incidents.breachEnd}.")
                } else {
                    append(" No breach detected.")
                }
            },
            style = MaterialTheme.typography.bodySmall,
            color = colors.bodyMuted,
        )
    }
}
