package com.krishichain.app.ui.verify.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Cancel
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.krishichain.app.domain.BADGE_COPY
import com.krishichain.app.domain.VerificationStatus
import com.krishichain.app.ui.theme.KrishiTheme
import com.krishichain.app.ui.theme.RadiusFull
import com.krishichain.app.ui.theme.Spacing

/**
 * Kotlin port of `apps/web/components/Badge.tsx`'s rendering half (the decision half lives in
 * `domain/Badge.kt`, shared with the chart/timeline). `.badge` pill + `.badge--*` variant colors
 * from `globals.css`.
 *
 * UI redesign: now includes a leading Material icon for each status and a subtle border ring
 * matching the status color at low opacity, giving the badges stronger visual identity without
 * breaking the DESIGN.md restrained-chrome principle.
 */
@Composable
fun BadgeChip(status: VerificationStatus, modifier: Modifier = Modifier) {
    val colors = KrishiTheme.colors
    val (bg, fg) = when (status) {
        VerificationStatus.VERIFIED -> colors.statusVerifiedWash to colors.statusVerified
        VerificationStatus.PENDING_ANCHOR -> colors.statusPendingWash to colors.statusPending
        VerificationStatus.FLAGGED -> colors.statusFlaggedWash to colors.statusFlagged
        VerificationStatus.UNVERIFIABLE -> colors.statusUnverifiableWash to colors.statusUnverifiable
    }
    val icon = when (status) {
        VerificationStatus.VERIFIED -> Icons.Rounded.CheckCircle
        VerificationStatus.PENDING_ANCHOR -> Icons.Rounded.Schedule
        VerificationStatus.FLAGGED -> Icons.Rounded.Warning
        VerificationStatus.UNVERIFIABLE -> Icons.Rounded.Cancel
    }
    val label = BADGE_COPY.getValue(status).label

    val shape = RoundedCornerShape(RadiusFull)
    Row(
        modifier = modifier
            .background(bg, shape)
            .border(1.dp, fg.copy(alpha = 0.25f), shape)
            .padding(horizontal = 14.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = fg,
            modifier = Modifier.size(16.dp),
        )
        Text(
            text = label.uppercase(),
            style = MaterialTheme.typography.labelMedium,
            color = fg,
        )
    }
}

/** Small variant used inline inside `VerifyPanel` for "Pending anchor" / "Not deployed" /
 *  "Proof valid" / "Proof invalid" / "Checking…", matching the web app's inline `<span
 *  className="badge ...">` usage that isn't tied to [VerificationStatus]. */
@Composable
fun InlineBadge(
    label: String,
    background: Color,
    foreground: Color,
    icon: ImageVector? = null,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (icon != null) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = foreground,
                modifier = Modifier.size(14.dp),
            )
        }
        Text(
            text = label.uppercase(),
            style = MaterialTheme.typography.labelMedium,
            color = foreground,
        )
    }
}

