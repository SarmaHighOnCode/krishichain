#include "signer.h"

#include <string.h>
#include <uECC.h>

#include "keccak256.h"
#include "sha256.h"

namespace krishi {
namespace {

// micro-ecc needs a hash context for RFC 6979 deterministic signing.
// `tmp` must be 2 * result_size + block_size = 2*32 + 64 = 128 bytes.
struct Sha256Context {
  uECC_HashContext uECC;
  sha256_ctx ctx;
};

void initHash(const uECC_HashContext* base) {
  sha256_init(&reinterpret_cast<Sha256Context*>(const_cast<uECC_HashContext*>(base))->ctx);
}

void updateHash(const uECC_HashContext* base, const uint8_t* message, unsigned size) {
  sha256_update(&reinterpret_cast<Sha256Context*>(const_cast<uECC_HashContext*>(base))->ctx,
                message, size);
}

void finishHash(const uECC_HashContext* base, uint8_t* hash) {
  sha256_final(&reinterpret_cast<Sha256Context*>(const_cast<uECC_HashContext*>(base))->ctx, hash);
}

// secp256k1 group order n, and n/2. micro-ecc does NOT normalise s; we must.
const uint8_t kOrder[32] = {
    0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFE,
    0xBA, 0xAE, 0xDC, 0xE6, 0xAF, 0x48, 0xA0, 0x3B, 0xBF, 0xD2, 0x5E, 0x8C, 0xD0, 0x36, 0x41, 0x41};

const uint8_t kHalfOrder[32] = {
    0x7F, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
    0x5D, 0x57, 0x6E, 0x73, 0x57, 0xA4, 0x50, 0x1D, 0xDF, 0xE9, 0x2F, 0x46, 0x68, 0x1B, 0x20, 0xA0};

int cmp32(const uint8_t* a, const uint8_t* b) { return memcmp(a, b, 32); }

/** s = n - s, big-endian, in place. */
void negateS(uint8_t* s) {
  uint8_t out[32];
  int borrow = 0;
  for (int i = 31; i >= 0; --i) {
    int diff = static_cast<int>(kOrder[i]) - s[i] - borrow;
    borrow = diff < 0;
    out[i] = static_cast<uint8_t>(diff + (borrow ? 256 : 0));
  }
  memcpy(s, out, 32);
}

}  // namespace

bool isLowS(const uint8_t sig[64]) { return cmp32(sig + 32, kHalfOrder) <= 0; }

bool derivePublicKey(const uint8_t privateKey[32], uint8_t out[65]) {
  out[0] = 0x04;  // uncompressed prefix; uECC emits the bare 64-byte X||Y
  return uECC_compute_public_key(privateKey, out + 1, uECC_secp256k1()) != 0;
}

bool deriveAddress(const uint8_t publicKey[65], uint8_t out[20]) {
  if (publicKey[0] != 0x04) return false;
  uint8_t hash[32];
  // Drop the 0x04 prefix before hashing
  keccak256(publicKey + 1, 64, hash);
  memcpy(out, hash + 12, 20);
  return true;
}

bool signDigest(const uint8_t privateKey[32], const uint8_t digest[32], uint8_t sig[64]) {
  uint8_t tmp[128];
  Sha256Context context;
  context.uECC.init_hash = &initHash;
  context.uECC.update_hash = &updateHash;
  context.uECC.finish_hash = &finishHash;
  context.uECC.block_size = 64;
  context.uECC.result_size = 32;
  context.uECC.tmp = tmp;

  if (!uECC_sign_deterministic(privateKey, digest, 32, &context.uECC, sig, uECC_secp256k1())) {
    return false;
  }
  if (!isLowS(sig)) negateS(sig + 32);
  return true;
}

}  // namespace krishi
