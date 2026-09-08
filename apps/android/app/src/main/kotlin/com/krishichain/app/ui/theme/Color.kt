package com.krishichain.app.ui.theme

import androidx.compose.ui.graphics.Color

/*
 * Direct port of the tokens in DESIGN.md + apps/web/app/globals.css's `:root` block (the "S2-01
 * design language" / "S2-10 contrast fix" extension). This app is themed entirely off those
 * tokens rather than stock Material3 purple — no dark-mode variant exists here because
 * globals.css doesn't define one either; the web reference is light-only.
 */

// --- DESIGN.md: colors ---
val ColorPrimary = Color(0xFF17171C)
val ColorBlack = Color(0xFF000000)
val ColorInk = Color(0xFF212121)
val ColorDeepGreen = Color(0xFF003C33)
val ColorNavy = Color(0xFF071829)
val ColorCanvas = Color(0xFFFFFFFF)
val ColorStone = Color(0xFFEEECE7)
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

/** S2-10: --color-slate (#75758a) fails AA text contrast on the light washes/chips this app
 *  uses it on. This darker variant is used for text; ColorSlate stays for decorative use. */
val ColorSlateStrong = Color(0xFF4A4A5C)

// --- extension: the four verification states (globals.css lines 36-46) ---
val StatusVerified = ColorDeepGreen
val StatusVerifiedWash = ColorPaleGreen
val StatusPending = ColorSlateStrong
val StatusPendingWash = ColorStone
val StatusFlagged = Color(0xFF9C3C17)
val StatusFlaggedWash = Color(0xFFFFE9E2)
val StatusUnverifiable = ColorError
val StatusUnverifiableWash = Color(0xFFFBE6E4)
