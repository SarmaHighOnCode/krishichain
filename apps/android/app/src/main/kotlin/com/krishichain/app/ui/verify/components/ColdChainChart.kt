package com.krishichain.app.ui.verify.components

import androidx.compose.foundation.Canvas
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.krishichain.app.data.model.LotRecordDto
import com.krishichain.app.domain.DEFAULT_TEMP_MAX_C
import com.krishichain.app.domain.deriveIncidents
import com.krishichain.app.ui.common.SectionCard
import com.krishichain.app.ui.theme.KrishiTheme
import com.krishichain.app.ui.theme.Spacing
import kotlin.math.max
import kotlin.math.min

/**
 * Kotlin/Compose port of `apps/web/components/ColdChainChart.tsx` — a hand-drawn line chart (a
 * Compose `Canvas`, same reasoning as the web version's hand-drawn inline SVG: one series doesn't
 * earn a charting library dependency), plotting `record.t` (deci-C) over sequence, with the
 * breach window shaded and a dashed threshold line at `tempMaxC`.
 *
 * UI redesign: now draws an area fill under the line, Y-axis temp labels, X-axis seq markers,
 * a threshold annotation, and a legend row below the chart.
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

    SectionCard(modifier = modifier) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(bottom = com.krishichain.app.ui.theme.Spacing.sm)
            ) {
                androidx.compose.foundation.layout.Box(
                    modifier = Modifier
                        .size(24.dp)
                        .clip(androidx.compose.foundation.shape.RoundedCornerShape(6.dp))
                        .background(colors.cardAccentNavy)
                )
                Spacer(Modifier.width(12.dp))
                Text("Temperature", style = MaterialTheme.typography.titleLarge, color = colors.slateStrong)
            }
            Text(
                "Temperature history for ${records.size} readings.",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.bodyMuted
            )
            Spacer(Modifier.height(com.krishichain.app.ui.theme.Spacing.md))
            androidx.compose.material3.HorizontalDivider(color = colors.ink.copy(alpha = 0.05f))
            Spacer(Modifier.height(com.krishichain.app.ui.theme.Spacing.lg))

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(androidx.compose.foundation.shape.RoundedCornerShape(com.krishichain.app.ui.theme.RadiusLg))
                    .background(androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.02f))
                    .background(
                        androidx.compose.ui.graphics.Brush.verticalGradient(
                            colors = listOf(
                                androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.06f),
                                androidx.compose.ui.graphics.Color.Transparent
                            ),
                            startY = 0f,
                            endY = 30f // tight gradient for top inner shadow
                        )
                    )
                    .border(
                        width = 1.dp,
                        color = androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.05f),
                        shape = androidx.compose.foundation.shape.RoundedCornerShape(com.krishichain.app.ui.theme.RadiusLg)
                    )
                    .padding(com.krishichain.app.ui.theme.Spacing.lg)
            ) {
                val description = if (incidents.breached) {
                "Temperature chart with a cold-chain breach shaded from seq ${incidents.breachStart} to ${incidents.breachEnd}"
            } else {
                "Temperature chart, no cold-chain breach"
            }

            val textMeasurer = rememberTextMeasurer()
            val labelStyle = TextStyle(
                fontSize = 10.sp,
                color = colors.bodyMuted,
                fontFamily = MaterialTheme.typography.labelSmall.fontFamily,
            )

            Canvas(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(180.dp)
                    .semantics { contentDescription = description },
            ) {
                val leftPad = 40.dp.toPx()   // space for Y-axis labels
                val rightPad = 12.dp.toPx()
                val topPad = 16.dp.toPx()
                val bottomPad = 24.dp.toPx()  // space for X-axis labels
                val innerWidth = size.width - leftPad - rightPad
                val innerHeight = size.height - topPad - bottomPad

                val temps = records.map { it.t / 10.0 }
                val minTemp = min(temps.min(), tempMaxC.toDouble()) - 1.0
                val maxTemp = max(temps.max(), tempMaxC.toDouble()) + 1.0
                val range = (maxTemp - minTemp).let { if (it == 0.0) 1.0 else it }

                fun xFor(index: Int): Float = if (records.size == 1) {
                    leftPad + innerWidth / 2
                } else {
                    leftPad + (index.toFloat() / (records.size - 1)) * innerWidth
                }

                fun yFor(tempC: Double): Float =
                    (topPad + innerHeight - ((tempC - minTemp) / range) * innerHeight).toFloat()

                // --- Y-axis labels ---
                val maxTempLabel = "%.0f°".format(maxTemp)
                val minTempLabel = "%.0f°".format(minTemp)
                val threshLabel = "${tempMaxC}°C"

                drawText(
                    textMeasurer = textMeasurer,
                    text = maxTempLabel,
                    topLeft = Offset(2.dp.toPx(), topPad - 6.dp.toPx()),
                    style = labelStyle,
                )
                drawText(
                    textMeasurer = textMeasurer,
                    text = minTempLabel,
                    topLeft = Offset(2.dp.toPx(), topPad + innerHeight - 6.dp.toPx()),
                    style = labelStyle,
                )

                // --- X-axis seq labels ---
                val firstSeq = records.firstOrNull()?.seq ?: 0
                val lastSeq = records.lastOrNull()?.seq ?: 0
                drawText(
                    textMeasurer = textMeasurer,
                    text = "#$firstSeq",
                    topLeft = Offset(leftPad, topPad + innerHeight + 4.dp.toPx()),
                    style = labelStyle,
                )
                if (records.size > 1) {
                    val lastLabel = "#$lastSeq"
                    val lastLabelWidth = textMeasurer.measure(lastLabel, labelStyle).size.width
                    drawText(
                        textMeasurer = textMeasurer,
                        text = lastLabel,
                        topLeft = Offset(
                            leftPad + innerWidth - lastLabelWidth,
                            topPad + innerHeight + 4.dp.toPx(),
                        ),
                        style = labelStyle,
                    )
                }

                // --- Breach window shading ---
                if (incidents.breached && incidents.breachStart != null && incidents.breachEnd != null) {
                    val indexBySeq = records.withIndex().associate { (i, r) -> r.seq to i }
                    val x1 = xFor(indexBySeq[incidents.breachStart] ?: 0)
                    val x2 = xFor(indexBySeq[incidents.breachEnd] ?: (records.size - 1))
                    val left = min(x1, x2) - 4f
                    val width = max(x2 - x1, 0f) + 8f
                    drawRect(
                        color = colors.statusFlaggedWash,
                        topLeft = Offset(left, topPad),
                        size = Size(width.coerceAtLeast(8f), innerHeight),
                    )
                    // Stronger inner tint for emphasis
                    drawRect(
                        color = colors.chartFillBreach,
                        topLeft = Offset(left, topPad),
                        size = Size(width.coerceAtLeast(8f), innerHeight),
                    )
                }

                // --- Dashed threshold line ---
                val thresholdY = yFor(tempMaxC.toDouble())
                drawLine(
                    color = colors.hairline,
                    start = Offset(leftPad, thresholdY),
                    end = Offset(size.width - rightPad, thresholdY),
                    strokeWidth = 1.dp.toPx(),
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f, 6f), 0f),
                )
                // Threshold label
                drawText(
                    textMeasurer = textMeasurer,
                    text = threshLabel,
                    topLeft = Offset(2.dp.toPx(), thresholdY - 14.dp.toPx()),
                    style = labelStyle.copy(
                        color = if (incidents.breached) colors.statusFlagged else colors.bodyMuted,
                    ),
                )

                // --- Area fill ---
                val lineColor = if (incidents.breached) colors.chartLineBreach else colors.chartLineOk
                val fillColor = if (incidents.breached) colors.chartFillBreach else colors.chartFillOk

                val areaPath = Path()
                records.forEachIndexed { index, record ->
                    val x = xFor(index)
                    val y = yFor(record.t / 10.0)
                    if (index == 0) areaPath.moveTo(x, y) else areaPath.lineTo(x, y)
                }
                // Close the area path down to the X-axis baseline
                areaPath.lineTo(xFor(records.size - 1), topPad + innerHeight)
                areaPath.lineTo(xFor(0), topPad + innerHeight)
                areaPath.close()
                drawPath(path = areaPath, color = fillColor)

                // --- Temperature line (drawn over the fill) ---
                val linePath = Path()
                records.forEachIndexed { index, record ->
                    val x = xFor(index)
                    val y = yFor(record.t / 10.0)
                    if (index == 0) linePath.moveTo(x, y) else linePath.lineTo(x, y)
                }
                drawPath(
                    path = linePath,
                    color = lineColor,
                    style = Stroke(width = 2.5.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round),
                )

                // --- Data point dots ---
                records.forEachIndexed { index, record ->
                    val x = xFor(index)
                    val y = yFor(record.t / 10.0)
                    drawCircle(color = lineColor, radius = 3.dp.toPx(), center = Offset(x, y))
                    drawCircle(
                        color = colors.surfaceElevated,
                        radius = 1.5.dp.toPx(),
                        center = Offset(x, y),
                    )
                }
            }

            Spacer(Modifier.height(Spacing.md))

            // --- Legend row ---
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                LegendItem(
                    color = if (incidents.breached) colors.chartLineBreach else colors.chartLineOk,
                    label = "Temperature",
                )
                LegendItem(color = colors.hairline, label = "Threshold", dashed = true)
                if (incidents.breached) {
                    LegendItem(color = colors.statusFlaggedWash, label = "Breach window", filled = true)
                }
            }

            Spacer(Modifier.height(Spacing.sm))
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
}
}

@Composable
private fun LegendItem(
    color: androidx.compose.ui.graphics.Color,
    label: String,
    dashed: Boolean = false,
    filled: Boolean = false,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (filled) {
            Spacer(
                modifier = Modifier
                    .size(10.dp)
                    .background(color, CircleShape),
            )
        } else {
            // Line segment indicator
            Spacer(
                modifier = Modifier
                    .width(12.dp)
                    .height(2.dp)
                    .background(color),
            )
        }
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = KrishiTheme.colors.bodyMuted,
        )
    }
}

