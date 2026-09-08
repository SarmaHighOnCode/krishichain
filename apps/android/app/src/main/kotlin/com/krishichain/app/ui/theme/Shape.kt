package com.krishichain.app.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.dp

/** DESIGN.md's radius scale, mapped onto Material3's five shape slots. */
val RadiusXs = 4.dp
val RadiusSm = 8.dp
val RadiusMd = 16.dp
val RadiusLg = 22.dp
val RadiusXl = 30.dp
val RadiusPill = 32.dp
val RadiusFull = 9999.dp

val KrishiShapes = Shapes(
    extraSmall = RoundedCornerShape(RadiusXs),
    small = RoundedCornerShape(RadiusSm),
    medium = RoundedCornerShape(RadiusMd),
    large = RoundedCornerShape(RadiusLg),
    extraLarge = RoundedCornerShape(RadiusXl),
)
