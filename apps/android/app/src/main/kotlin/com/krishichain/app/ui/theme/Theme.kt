package com.krishichain.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf

/**
 * The four verification-state colors and a few other DESIGN.md tokens (hairline, muted text,
 * card border) don't map onto any of Material3's named ColorScheme slots, so — same as
 * globals.css defining `--status-*` custom properties alongside the DESIGN.md palette — they're
 * exposed through their own CompositionLocal rather than forced into `error`/`tertiary`/etc.
 * roles that would carry the wrong semantics.
 */
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
)

val LocalKrishiColors = staticCompositionLocalOf { KrishiExtendedColors() }

private val KrishiColorScheme = lightColorScheme(
    primary = ColorPrimary,
    onPrimary = ColorOnPrimary,
    secondary = ColorActionBlue,
    onSecondary = ColorOnPrimary,
    background = ColorCanvas,
    onBackground = ColorInk,
    surface = ColorCanvas,
    onSurface = ColorInk,
    surfaceVariant = ColorStone,
    onSurfaceVariant = ColorBodyMuted,
    outline = ColorHairline,
    outlineVariant = ColorCardBorder,
    error = ColorError,
    onError = ColorOnPrimary,
)

/**
 * The design reference (globals.css) has no dark-mode variant — this is a deliberate,
 * light-only theme rather than an oversight. A real dark palette (and a call to
 * `isSystemInDarkTheme()` to pick it) is future work, not something to invent unprompted here.
 */
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
