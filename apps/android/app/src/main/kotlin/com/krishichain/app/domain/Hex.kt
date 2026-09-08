package com.krishichain.app.domain

/** `0x`-prefixed lowercase-or-mixed-case hex string, as used throughout `packages/core`. */
typealias Hex = String

/** Strip an optional `0x` prefix and decode pairs of hex digits into bytes. */
fun hexToBytes(hex: Hex): ByteArray {
    val clean = if (hex.startsWith("0x") || hex.startsWith("0X")) hex.substring(2) else hex
    require(clean.length % 2 == 0) { "hex string must have an even number of digits: $hex" }
    return ByteArray(clean.length / 2) { i ->
        clean.substring(i * 2, i * 2 + 2).toInt(16).toByte()
    }
}

/** Encode bytes as a lowercase `0x`-prefixed hex string. */
fun ByteArray.toHex(): Hex {
    val sb = StringBuilder(2 + size * 2)
    sb.append("0x")
    for (b in this) sb.append(String.format("%02x", b))
    return sb.toString()
}

/** Left-pad a byte array to `length` bytes with leading zeros (for ABI-encoding a uint256). */
fun ByteArray.leftPad(length: Int): ByteArray {
    if (size >= length) return this
    val out = ByteArray(length)
    System.arraycopy(this, 0, out, length - size, size)
    return out
}
