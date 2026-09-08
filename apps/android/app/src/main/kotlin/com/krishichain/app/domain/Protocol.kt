package com.krishichain.app.domain

/**
 * Chain-continuity verdicts. Kotlin mirror of `ChainVerdict` in `packages/core/src/chain.ts`.
 * Kept as plain string constants (rather than a sealed class over the wire type) so the
 * gateway's JSON — the actual verdict vocabulary — decodes without a custom serializer.
 */
object ChainVerdict {
    /** Correct successor. Stored. */
    const val ACCEPT = "ACCEPT"

    /** Already seen, byte-identical. Idempotent no-op — NOT a trust break. */
    const val DUPLICATE = "DUPLICATE"

    /** seq jumped forward — records are missing. A trust break. */
    const val CHAIN_GAP = "CHAIN_GAP"

    /** Same seq, different digest, or prev mismatch — divergent device history. A trust break. */
    const val CHAIN_FORK = "CHAIN_FORK"
}

/** Record flag bits (PROTOCOL.md §1.2), mirroring `Flags` in `packages/core/src/types.ts`. */
object Flags {
    const val LID_OPEN = 1 shl 0
    const val SHOCK = 1 shl 1
    const val SENSOR_FAULT = 1 shl 2
    const val BUFFERED = 1 shl 3
    const val BOOT = 1 shl 4
    const val LOT_BOUND = 1 shl 5
    const val CAL = 1 shl 6
}
