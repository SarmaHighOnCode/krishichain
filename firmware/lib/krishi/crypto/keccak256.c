#include "keccak256.h"
#include <string.h>

#define ROL64(x, y) (((x) << (y)) | ((x) >> (64 - (y))))

static const uint64_t RC[24] = {
    0x0000000000000001ULL, 0x0000000000008082ULL, 0x800000000000808aULL,
    0x8000000080008000ULL, 0x000000000000808bULL, 0x0000000080000001ULL,
    0x8000000080008081ULL, 0x8000000000008009ULL, 0x000000000000008aULL,
    0x0000000000000088ULL, 0x0000000080008009ULL, 0x000000008000000aULL,
    0x000000008000808bULL, 0x800000000000008bULL, 0x8000000000008089ULL,
    0x8000000000008003ULL, 0x8000000000008002ULL, 0x8000000000000080ULL,
    0x000000000000800aULL, 0x800000008000000aULL, 0x8000000080008081ULL,
    0x8000000000008080ULL, 0x0000000080000001ULL, 0x8000000080008008ULL
};

static const int rot[5][5] = {
    {0,  36, 3,  41, 18},
    {1,  44, 10, 45, 2 },
    {62, 6,  43, 15, 61},
    {28, 55, 25, 21, 56},
    {27, 20, 39, 8,  14}
};

static void keccakf(uint64_t st[5][5]) {
  for (int round = 0; round < 24; round++) {
    // Theta
    uint64_t C[5], D[5];
    for (int x = 0; x < 5; x++) {
      C[x] = st[x][0] ^ st[x][1] ^ st[x][2] ^ st[x][3] ^ st[x][4];
    }
    for (int x = 0; x < 5; x++) {
      D[x] = C[(x + 4) % 5] ^ ROL64(C[(x + 1) % 5], 1);
    }
    for (int x = 0; x < 5; x++) {
      for (int y = 0; y < 5; y++) {
        st[x][y] ^= D[x];
      }
    }

    // Rho and Pi
    uint64_t B[5][5];
    for (int x = 0; x < 5; x++) {
      for (int y = 0; y < 5; y++) {
        B[x][y] = ROL64(st[(x + 3 * y) % 5][x], rot[(x + 3 * y) % 5][x]);
      }
    }

    // Chi
    for (int x = 0; x < 5; x++) {
      for (int y = 0; y < 5; y++) {
        st[x][y] = B[x][y] ^ ((~B[(x + 1) % 5][y]) & B[(x + 2) % 5][y]);
      }
    }

    // Iota
    st[0][0] ^= RC[round];
  }
}

void keccak256(const uint8_t* data, size_t len, uint8_t out[32]) {
  uint64_t st[5][5];
  memset(st, 0, sizeof(st));
  uint8_t block[136];
  size_t offset = 0;

  while (len >= 136) {
    for (size_t i = 0; i < 136; i++) {
      size_t x = (i / 8) % 5;
      size_t y = (i / 8) / 5;
      st[x][y] ^= ((uint64_t)data[offset + i]) << ((i % 8) * 8);
    }
    keccakf(st);
    offset += 136;
    len -= 136;
  }

  memset(block, 0, 136);
  if (len > 0 && data) {
    memcpy(block, data + offset, len);
  }
  block[len] ^= 0x01;
  block[135] ^= 0x80;

  for (size_t i = 0; i < 136; i++) {
    size_t x = (i / 8) % 5;
    size_t y = (i / 8) / 5;
    st[x][y] ^= ((uint64_t)block[i]) << ((i % 8) * 8);
  }
  keccakf(st);

  for (size_t i = 0; i < 32; i++) {
    size_t x = (i / 8) % 5;
    size_t y = (i / 8) / 5;
    out[i] = (uint8_t)(st[x][y] >> ((i % 8) * 8));
  }
}
