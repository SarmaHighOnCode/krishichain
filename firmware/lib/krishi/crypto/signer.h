#pragma once
#include <stddef.h>
#include <stdint.h>

namespace krishi {

/**
 * Derives uncompressed 65-byte secp256k1 public key (0x04 || X || Y) from 32-byte private key.
 */
bool derivePublicKey(const uint8_t privateKey[32], uint8_t out[65]);

/**
 * Derives 20-byte Ethereum address from 65-byte uncompressed public key:
 * keccak256(pubKey[1:65])[12:32].
 */
bool deriveAddress(const uint8_t publicKey[65], uint8_t out[20]);

/**
 * Signs 32-byte digest using RFC 6979 deterministic secp256k1 signature with low-s normalisation.
 * Emits 64-byte raw signature R || S.
 */
bool signDigest(const uint8_t privateKey[32], const uint8_t digest[32], uint8_t sig[64]);

/**
 * Checks if signature s component is in low half of curve order (s <= n/2).
 */
bool isLowS(const uint8_t sig[64]);

}  // namespace krishi
