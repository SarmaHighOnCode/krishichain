@file:OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)

package com.krishichain.app.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.krishichain.app.R

/*
 * DESIGN.md's type families: CohereText (display) -> Space Grotesk, Unica77 Cohere Web (body/UI)
 * -> Inter, CohereMono (technical labels) -> IBM Plex Mono. None of the three proprietary Cohere
 * faces are licensed for bundling, so this app ships DESIGN.md's own documented open-source
 * fallbacks (see DESIGN.md "Font Family") as static TTF assets under res/font/ rather than the
 * runtime Downloadable Fonts API — CLAUDE.md invariant #6 rules out a font that depends on a
 * network fetch (or Google Play Services) at first paint. Space Grotesk and Inter ship here as
 * their variable-font files, so intermediate weights come from FontVariation rather than needing
 * a static file per weight.
 */

private fun variableFont(resId: Int, weight: Int) = Font(
    resId = resId,
    weight = FontWeight(weight),
    variationSettings = FontVariation.Settings(FontVariation.weight(weight)),
)

val SpaceGrotesk = FontFamily(
    variableFont(R.font.space_grotesk, 400),
    variableFont(R.font.space_grotesk, 500),
)

val Inter = FontFamily(
    variableFont(R.font.inter, 400),
    variableFont(R.font.inter, 500),
    variableFont(R.font.inter, 600),
)

val IbmPlexMono = FontFamily(Font(R.font.ibm_plex_mono, FontWeight.Normal))

/**
 * Typography scale — DESIGN.md's Section Heading / Card Heading / Body / Mono Label rows, scaled
 * down for a mobile verify screen the same way `globals.css`'s h1 rule does ("Section Heading
 * scale, scaled down for a 360px-first verification page rather than the 48px marketing size").
 */
val KrishiTypography = Typography(
    headlineLarge = TextStyle(
        fontFamily = SpaceGrotesk,
        fontWeight = FontWeight.Normal,
        fontSize = 30.sp,
        lineHeight = 34.sp,
        letterSpacing = (-0.3).sp,
    ),
    headlineMedium = TextStyle(
        fontFamily = SpaceGrotesk,
        fontWeight = FontWeight.Normal,
        fontSize = 21.sp,
        lineHeight = 25.sp,
        letterSpacing = (-0.1).sp,
    ),
    titleMedium = TextStyle(
        fontFamily = Inter,
        fontWeight = FontWeight.Medium,
        fontSize = 16.sp,
        lineHeight = 22.sp,
    ),
    bodyLarge = TextStyle(
        fontFamily = Inter,
        fontWeight = FontWeight.Normal,
        fontSize = 16.sp,
        lineHeight = 24.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = Inter,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        lineHeight = 21.sp,
    ),
    bodySmall = TextStyle(
        fontFamily = Inter,
        fontWeight = FontWeight.Normal,
        fontSize = 13.sp,
        lineHeight = 18.sp,
    ),
    labelLarge = TextStyle(
        fontFamily = Inter,
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        lineHeight = 20.sp,
    ),
    labelMedium = TextStyle(
        // "Mono Label" (DESIGN.md): uppercase technical labels, category/system markers — used
        // for badges, digests, seq numbers, and the eyebrow labels above the chart/timeline.
        fontFamily = IbmPlexMono,
        fontWeight = FontWeight.Normal,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.4.sp,
    ),
    labelSmall = TextStyle(
        fontFamily = IbmPlexMono,
        fontWeight = FontWeight.Normal,
        fontSize = 11.sp,
        lineHeight = 15.sp,
        letterSpacing = 0.3.sp,
    ),
)
