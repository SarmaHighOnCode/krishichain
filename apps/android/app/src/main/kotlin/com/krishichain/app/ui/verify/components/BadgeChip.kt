package com.krishichain.app.ui.verify.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.krishichain.app.domain.BADGE_COPY
import com.krishichain.app.domain.VerificationStatus
import com.krishichain.app.ui.theme.KrishiTheme
import com.krishichain.app.ui.theme.RadiusFull

/**
 * Kotlin port of `apps/web/components/Badge.tsx`'s rendering half (the decision half lives in
 * `domain/Badge.kt`, shared with the chart/timeline). `.badge` pill + `.badge--*` variant colors
 * from `globals.css`.
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
    val label = BADGE_COPY.getValue(status).label

    Text(
        text = label.uppercase(),
        style = MaterialTheme.typography.labelMedium,
        color = fg,
        modifier = modifier
            .background(bg, RoundedCornerShape(RadiusFull))
            .padding(horizontal = 12.dp, vertical = 6.dp),
    )
}

/** Small variant used inline inside `VerifyPanel` for "Pending anchor" / "Not deployed" /
 *  "Proof valid" / "Proof invalid" / "Checking…", matching the web app's inline `<span
 *  className="badge ...">` usage that isn't tied to [VerificationStatus]. */
@Composable
fun InlineBadge(label: String, background: Color, foreground: Color, modifier: Modifier = Modifier) {
    Text(
        text = label.uppercase(),
        style = MaterialTheme.typography.labelMedium,
        color = foreground,
        modifier = modifier
            .background(background, RoundedCornerShape(RadiusFull))
            .padding(horizontal = 12.dp, vertical = 6.dp),
    )
}
