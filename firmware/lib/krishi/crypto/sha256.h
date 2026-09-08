#pragma once
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
  uint32_t state[8];
  uint64_t bitlen;
  uint8_t buf[64];
  size_t buflen;
} sha256_ctx;

void sha256_init(sha256_ctx* ctx);
void sha256_update(sha256_ctx* ctx, const uint8_t* data, size_t len);
void sha256_final(sha256_ctx* ctx, uint8_t out[32]);

#ifdef __cplusplus
}
#endif
