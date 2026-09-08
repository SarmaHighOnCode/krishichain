package com.krishichain.app.ui.common

import android.graphics.BlurMaskFilter
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.krishichain.app.ui.theme.KrishiTheme
import com.krishichain.app.ui.theme.RadiusLg
import com.krishichain.app.ui.theme.RadiusMd
import com.krishichain.app.ui.theme.Spacing

fun Modifier.dropShadow(
    color: Color = Color.Black,
    borderRadius: Dp = 0.dp,
    blurRadius: Dp = 0.dp,
    offsetY: Dp = 0.dp,
    offsetX: Dp = 0.dp,
    spread: Dp = 0.dp,
) = this.drawBehind {
    this.drawIntoCanvas {
        val paint = Paint()
        val frameworkPaint = paint.asFrameworkPaint()
        val spreadPixel = spread.toPx()
        val leftPixel = (0f - spreadPixel) + offsetX.toPx()
        val topPixel = (0f - spreadPixel) + offsetY.toPx()
        val rightPixel = (this.size.width + spreadPixel)
        val bottomPixel = (this.size.height + spreadPixel)

        if (blurRadius != 0.dp) {
            frameworkPaint.maskFilter =
                (BlurMaskFilter(blurRadius.toPx(), BlurMaskFilter.Blur.NORMAL))
        }

        frameworkPaint.color = color.toArgb()
        it.drawRoundRect(
            left = leftPixel,
            top = topPixel,
            right = rightPixel,
            bottom = bottomPixel,
            radiusX = borderRadius.toPx(),
            radiusY = borderRadius.toPx(),
            paint
        )
    }
}

/**
 * Reusable card wrapper: pure white background, soft shadow, large rounded corners,
 * and no colored borders, matching the clean reference image style.
 */
@Composable
fun SectionCard(
    modifier: Modifier = Modifier,
    accentColor: Color? = null, // Kept for API compatibility but no longer rendered as a border
    elevated: Boolean = true,
    content: @Composable () -> Unit,
) {
    val colors = KrishiTheme.colors
    val shape = RoundedCornerShape(RadiusLg) // Increased to RadiusLg for rounder look

    val shadowModifier = if (elevated) {
        Modifier.dropShadow(
            color = colors.ink.copy(alpha = 0.06f), // Softer, lower opacity shadow
            borderRadius = RadiusLg,
            blurRadius = 32.dp, // Larger blur for a softer, diffuse shadow
            offsetY = 12.dp,
        )
    } else {
        Modifier
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .then(shadowModifier)
            .clip(shape)
            .border(1.dp, colors.ink.copy(alpha = 0.05f), shape) // Very subtle inner border
            .background(Color.White, shape),
    ) {
        // Removed the accentColor colored top border to match the clean reference image
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(Spacing.xl),
        ) {
            content()
        }
    }
}
