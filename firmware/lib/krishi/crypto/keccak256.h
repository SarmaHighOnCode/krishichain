#pragma once
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Keccak-256 as used by Ethereum.
 *
 * NOT SHA3-256. Same permutation, different domain separator: Keccak pads with
 * 0x01, SHA3-256 pads with 0x06. Substituting one for the other yields digests
 * that look fine and verify nowhere.
 */
void keccak256(const uint8_t* data, size_t len, uint8_t out[32]);

#ifdef __cplusplus
}
#endif
