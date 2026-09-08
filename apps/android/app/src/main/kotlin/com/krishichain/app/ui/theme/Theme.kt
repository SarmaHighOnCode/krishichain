package com.krishichain.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf

data class KrishiExtendedColors(
    val ink: androidx.compose.ui.graphics.Color = ColorInk,
    val bodyMuted: androidx.compose.ui.graphics.Color = ColorBodyMuted,
    val slateStrong: androidx.compose.ui.graphics.Color = ColorSlateStrong,
    val hairline: androidx.compose.ui.graphics.Color = ColorHairline,
    val cardBorder: androidx.compose.ui.graphics.Color = ColorCardBorder,
    val stone: androidx.compose.ui.graphics.Color = ColorStone,
    val actionBlue: androidx.compose.ui.graphics.Color = ColorActionBlue,
    val focusBlue: androidx.compose.ui.graphics.Color = ColorFocusBlue,
    val statusVerified: androidx.compose.ui.graphics.Color = StatusVerified,
    val statusVerifiedWash: androidx.compose.ui.graphics.Color = StatusVerifiedWash,
    val statusPending: androidx.compose.ui.graphics.Color = StatusPending,
    val statusPendingWash: androidx.compose.ui.graphics.Color = StatusPendingWash,
    val statusFlagged: androidx.compose.ui.graphics.Color = StatusFlagged,
    val statusFlaggedWash: androidx.compose.ui.graphics.Color = StatusFlaggedWash,
    val statusUnverifiable: androidx.compose.ui.graphics.Color = StatusUnverifiable,
    val statusUnverifiableWash: androidx.compose.ui.graphics.Color = StatusUnverifiableWash,
    val surfaceElevated: androidx.compose.ui.graphics.Color = SurfaceElevated,
    val chartFillOk: androidx.compose.ui.graphics.Color = ChartFillOk,
    val chartFillBreach: androidx.compose.ui.graphics.Color = ChartFillBreach,
    val chartLineOk: androidx.compose.ui.graphics.Color = ChartLineOk,
    val chartLineBreach: androidx.compose.ui.graphics.Color = ChartLineBreach,
    val glowVerified: androidx.compose.ui.graphics.Color = GlowVerified,
    val glowFlagged: androidx.compose.ui.graphics.Color = GlowFlagged,
    val glowUnverifiable: androidx.compose.ui.graphics.Color = GlowUnverifiable,
    val rowTintAlternate: androidx.compose.ui.graphics.Color = RowTintAlternate,
    val deepGreen: androidx.compose.ui.graphics.Color = ColorDeepGreen,
    val onPrimary: androidx.compose.ui.graphics.Color = ColorOnPrimary,
    
    // Pastel Hero gradients
    val heroGradientStart: androidx.compose.ui.graphics.Color = HeroGradientStart,
    val heroGradientMid1: androidx.compose.ui.graphics.Color = HeroGradientMid1,
    val heroGradientMid2: androidx.compose.ui.graphics.Color = HeroGradientMid2,
    val heroGradientEnd: androidx.compose.ui.graphics.Color = HeroGradientEnd,
    
    // Card accents
    val cardAccentPurple: androidx.compose.ui.graphics.Color = CardAccentPurple,
    val cardAccentNavy: androidx.compose.ui.graphics.Color = CardAccentNavy,
)

val LocalKrishiColors = staticCompositionLocalOf { KrishiExtendedColors() }

private val KrishiColorScheme = lightColorScheme(
    primary = ColorPrimary,
    onPrimary = ColorOnPrimary,
    secondary = ColorActionBlue,
    onSecondary = ColorOnPrimary,
    background = ColorStone,     // Screen background is light grey
    onBackground = ColorInk,
    surface = ColorCanvas,       // Cards are white
    onSurface = ColorInk,
    surfaceVariant = ColorStone,
    onSurfaceVariant = ColorBodyMuted,
    outline = ColorHairline,
    outlineVariant = ColorCardBorder,
    error = ColorError,
    onError = ColorOnPrimary,
)

@Composable
fun KrishiChainTheme(content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalKrishiColors provides KrishiExtendedColors()) {
        MaterialTheme(
            colorScheme = KrishiColorScheme,
            typography = KrishiTypography,
            shapes = KrishiShapes,
            content = content,
        )
    }
}

object KrishiTheme {
    val colors: KrishiExtendedColors
        @Composable
        get() = LocalKrishiColors.current
}
