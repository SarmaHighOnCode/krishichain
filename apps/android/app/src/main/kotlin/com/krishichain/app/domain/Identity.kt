package com.krishichain.app.domain

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import java.math.BigInteger
import java.security.SecureRandom

/**
 * Device "soft key" identity — SWARM-API.md's own term for a key that lives in app storage
 * rather than a hardware secure element, same trust tier as an ESP32's key in flash. Generated
 * once on-device (secp256k1, via Bouncy Castle — see [Signing]) and persisted so the phone keeps
 * the same [DeviceIdentity.address] across restarts: a fresh key on every launch would mean a new
 * device every time, which would break the hash chain (a new `dev` can't continue an old `prev`)
 * and mean re-commissioning at the gateway on every app open.
 *
 * KEY STORAGE CHOICE: plain `SharedPreferences` with the raw private key base64-encoded, not
 * `androidx.security.EncryptedSharedPreferences`. Deliberate for this hackathon build: this key
 * signs demo sensor readings, not anything with real value, `EncryptedSharedPreferences` pulls in
 * a whole extra dependency (`androidx.security:security-crypto`) and Android Keystore machinery
 * for a threat model ("someone roots the demo phone to steal a fake cold-chain reading key") that
 * doesn't exist here, and CLAUDE.md's own protocol docs call this tier a "soft key" precisely
 * because it is demo-grade, not hardware-backed, on the ESP32 side too. If this code path ever
 * signs something real, swap this for `EncryptedSharedPreferences` or the Keystore first.
 */
data class DeviceIdentity(val privateKey: BigInteger, val address: Hex)

/**
 * The hash-chain and commissioning state that has to survive alongside the key — persisted
 * together because they are only meaningful together. `recordSeq`/`lastRecordDigest` are what
 * make restarting the app "continue this device's history" rather than "start signing seq=0
 * again with a key the gateway already has records for", which would read as `CHAIN_FORK` or
 * `DUPLICATE` depending on exact history.
 */
data class NodeChainState(
    /** True once `POST /devices` has successfully registered this address. */
    val commissioned: Boolean = false,
    /** Next record `seq` to use. Starts at 0 (genesis). */
    val recordSeq: Long = 0L,
    /** Digest of the most recently ACCEPTED record. All-zero until the first record is sent. */
    val lastRecordDigest: Hex = ZERO_DIGEST,
    /** Next companion `seq` to use. Independent counter — advisory only, no chain check. */
    val companionSeq: Long = 0L,
    /** The lot the last-sent record carried, so the `LOT_BOUND` flag fires only on the one
     *  record that actually transitions into a new lot, per PROTOCOL.md's flag table. */
    val lastLot: Hex = ZERO_LOT,
)

object Identity {
    private const val PREFS_NAME = "krishichain_virtual_node"

    private const val KEY_PRIVATE_KEY = "private_key_b64"
    private const val KEY_ADDRESS = "address"
    private const val KEY_COMMISSIONED = "commissioned"
    private const val KEY_RECORD_SEQ = "record_seq"
    private const val KEY_LAST_DIGEST = "last_record_digest"
    private const val KEY_COMPANION_SEQ = "companion_seq"
    private const val KEY_LAST_LOT = "last_lot"

    private fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /**
     * Load the persisted identity, or generate and persist a new one on first run. Idempotent —
     * safe to call on every screen entry, same as the existing verify screen's load pattern.
     */
    fun loadOrCreate(context: Context): DeviceIdentity {
        val p = prefs(context)
        val existingKey = p.getString(KEY_PRIVATE_KEY, null)
        if (existingKey != null) {
            val privateKey = BigInteger(1, Base64.decode(existingKey, Base64.NO_WRAP))
            val address = p.getString(KEY_ADDRESS, null) ?: addressFor(privateKey)
            return DeviceIdentity(privateKey, address)
        }

        val privateKey = generatePrivateKey()
        val address = addressFor(privateKey)
        p.edit()
            .putString(KEY_PRIVATE_KEY, Base64.encodeToString(privateKey.toFixedBytes(32), Base64.NO_WRAP))
            .putString(KEY_ADDRESS, address)
            .apply()
        return DeviceIdentity(privateKey, address)
    }

    fun loadState(context: Context): NodeChainState {
        val p = prefs(context)
        return NodeChainState(
            commissioned = p.getBoolean(KEY_COMMISSIONED, false),
            recordSeq = p.getLong(KEY_RECORD_SEQ, 0L),
            lastRecordDigest = p.getString(KEY_LAST_DIGEST, null) ?: ZERO_DIGEST,
            companionSeq = p.getLong(KEY_COMPANION_SEQ, 0L),
            lastLot = p.getString(KEY_LAST_LOT, null) ?: ZERO_LOT,
        )
    }

    fun saveState(context: Context, state: NodeChainState) {
        prefs(context).edit()
            .putBoolean(KEY_COMMISSIONED, state.commissioned)
            .putLong(KEY_RECORD_SEQ, state.recordSeq)
            .putString(KEY_LAST_DIGEST, state.lastRecordDigest)
            .putLong(KEY_COMPANION_SEQ, state.companionSeq)
            .putString(KEY_LAST_LOT, state.lastLot)
            .apply()
    }

    /** A uniform-random scalar in `[1, n-1]`, rejection-sampled so every value is equally likely
     *  (a naive mod-n reduction would bias the low end of the range). */
    private fun generatePrivateKey(): BigInteger {
        val random = SecureRandom()
        val n = SECP256K1_DOMAIN.n
        while (true) {
            val candidate = BigInteger(n.bitLength(), random)
            if (candidate >= BigInteger.ONE && candidate < n) return candidate
        }
    }

    /** Uncompressed 65-byte public key (`0x04` prefix) for a private key: `G * privateKey`. */
    fun publicKeyFor(privateKey: BigInteger): ByteArray =
        SECP256K1_DOMAIN.g.multiply(privateKey).normalize().getEncoded(false)

    /**
     * PROTOCOL's device-address derivation: `keccak256(uncompressedPubkey[1:])[12:]`. Forgetting
     * to drop the `0x04` prefix byte is, per `crypto.ts`'s header comment, the single most common
     * bug in device-identity code — this is why it's centralised here rather than inlined.
     */
    fun addressFor(privateKey: BigInteger): Hex {
        val pubKey = publicKeyFor(privateKey)
        require(pubKey.size == 65 && pubKey[0] == 0x04.toByte()) {
            "expected a 65-byte uncompressed public key starting with 0x04"
        }
        val hashed = keccak256(pubKey.copyOfRange(1, pubKey.size))
        return hashed.copyOfRange(12, hashed.size).toHex()
    }
}
