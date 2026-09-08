package com.krishichain.app.ui.theme

import androidx.compose.ui.graphics.Color

/*
 * Colors matching the web dashboard (Cohere-inspired language).
 */

val ColorPrimary = Color(0xFF17171C)
val ColorBlack = Color(0xFF000000)
val ColorInk = Color(0xFF212121)
val ColorDeepGreen = Color(0xFF003C33)
val ColorNavy = Color(0xFF071829)
val ColorCanvas = Color(0xFFFFFFFF)
val ColorStone = Color(0xFFF4F5F7) // Lighter grey for background
val ColorPaleGreen = Color(0xFFEDFCE9)
val ColorPaleBlue = Color(0xFFF1F5FF)
val ColorHairline = Color(0xFFD9D9DD)
val ColorBorderLight = Color(0xFFE5E7EB)
val ColorCardBorder = Color(0xFFF2F2F2)
val ColorMuted = Color(0xFF93939F)
val ColorSlate = Color(0xFF75758A)
val ColorBodyMuted = Color(0xFF616161)
val ColorActionBlue = Color(0xFF1863DC)
val ColorFocusBlue = Color(0xFF4C6EE6)
val ColorCoral = Color(0xFFFF7759)
val ColorCoralSoft = Color(0xFFFFAD9B)
val ColorFormFocus = Color(0xFF9B60AA)
val ColorOnPrimary = Color(0xFFFFFFFF)
val ColorError = Color(0xFFB30000)

val ColorSlateStrong = Color(0xFF4A4A5C)

// --- Verification states ---
val StatusVerified = ColorDeepGreen
val StatusVerifiedWash = ColorPaleGreen
val StatusPending = ColorSlateStrong
val StatusPendingWash = Color(0xFFEEECE7)
val StatusFlagged = Color(0xFF9C3C17)
val StatusFlaggedWash = Color(0xFFFFE9E2)
val StatusUnverifiable = ColorError
val StatusUnverifiableWash = Color(0xFFFBE6E4)

// --- UI redesign additions (Dashboard web styles) ---

// Pastel gradient colors for the hero card
val HeroGradientStart = Color(0xFFFDECD4) // Peach/Cream
val HeroGradientMid1 = Color(0xFFEFE8FD)  // Pale Lavender
val HeroGradientMid2 = Color(0xFFE8EBFE)  // Pale Blue
val HeroGradientEnd = Color(0xFFFFEDFB)   // Pale Pink

// Colors for the top borders of cards
val CardAccentPurple = Color(0xFF6644FF)
val CardAccentNavy = Color(0xFF1A1A3A)

val SurfaceElevated = ColorCanvas
val ChartFillOk = Color(0x1A003C33)
val ChartFillBreach = Color(0x1A9C3C17)
val ChartLineOk = Color(0xFF1B7A63)
val ChartLineBreach = Color(0xFFB84422)

val GlowVerified = Color(0x33003C33)
val GlowFlagged = Color(0x339C3C17)
val GlowUnverifiable = Color(0x33B30000)
val RowTintAlternate = Color(0x08000000)
