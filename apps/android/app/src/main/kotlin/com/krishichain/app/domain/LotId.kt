package com.krishichain.app.domain

/**
 * Lot ID extraction for the Scan tab's decoded QR payload.
 *
 * Per docs/PROTOCOL.md, `lot` is `bytes16` → `0x` + 32 hex chars (34 chars total) — same pattern
 * the web label sheet validates against (apps/web/app/ops/labels/page.tsx's `LOT_ID_PATTERN`).
 * A scanned QR is one of two shapes: a bare lot ID, or a label-sheet URL of the form
 * `<origin>/verify/<lotId>` — so this searches the whole payload rather than anchoring the regex,
 * and normalizes to lowercase to match the gateway's case-insensitive `/lot/:lotId` comparison.
 */
private val LOT_ID_PATTERN = Regex("0x[0-9a-fA-F]{32}")

fun extractLotId(rawValue: String): String? =
    LOT_ID_PATTERN.find(rawValue)?.value?.lowercase()
