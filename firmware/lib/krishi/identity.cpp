#include "identity.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <uECC.h>

#include "crypto/keccak256.h"
#include "crypto/signer.h"

#ifndef KRISHI_NATIVE
#include <Preferences.h>
#include <esp_random.h>
#endif

namespace krishi {

// --- MemoryKeyStore ---

bool MemoryKeyStore::load(uint8_t privateKey[32]) {
  if (!hasKey_) return false;
  memcpy(privateKey, key_, 32);
  return true;
}

bool MemoryKeyStore::save(const uint8_t privateKey[32]) {
  memcpy(key_, privateKey, 32);
  hasKey_ = true;
  return true;
}

bool MemoryKeyStore::clear() {
  memset(key_, 0, 32);
  hasKey_ = false;
  return true;
}

// --- NvsKeyStore ---

bool NvsKeyStore::load(uint8_t privateKey[32]) {
#ifndef KRISHI_NATIVE
  Preferences prefs;
  if (!prefs.begin("krishi", true)) return false;
  size_t len = prefs.getBytes("pk", privateKey, 32);
  prefs.end();
  return len == 32;
#else
  static MemoryKeyStore nativeNvsFallback;
  return nativeNvsFallback.load(privateKey);
#endif
}

bool NvsKeyStore::save(const uint8_t privateKey[32]) {
#ifndef KRISHI_NATIVE
  Preferences prefs;
  if (!prefs.begin("krishi", false)) return false;
  size_t len = prefs.putBytes("pk", privateKey, 32);
  prefs.end();
  return len == 32;
#else
  static MemoryKeyStore nativeNvsFallback;
  return nativeNvsFallback.save(privateKey);
#endif
}

bool NvsKeyStore::clear() {
#ifndef KRISHI_NATIVE
  Preferences prefs;
  if (!prefs.begin("krishi", false)) return false;
  bool ok = prefs.remove("pk");
  prefs.end();
  return ok;
#else
  static MemoryKeyStore nativeNvsFallback;
  return nativeNvsFallback.clear();
#endif
}

// --- Identity ---

#ifndef KRISHI_NATIVE
static int uECC_rng_esp(uint8_t* dest, unsigned size) {
  for (unsigned i = 0; i < size; ++i) {
    dest[i] = static_cast<uint8_t>(esp_random() & 0xFF);
  }
  return 1;
}
#else
static int uECC_rng_native(uint8_t* dest, unsigned size) {
  static uint32_t state = 987654321;
  for (unsigned i = 0; i < size; ++i) {
    state = state * 1103515245 + 12345;
    dest[i] = static_cast<uint8_t>((state >> 16) & 0xFF);
  }
  return 1;
}
#endif

bool Identity::begin(KeyStore& store) {
#ifndef KRISHI_NATIVE
  uECC_set_rng(&uECC_rng_esp);
#else
  uECC_set_rng(&uECC_rng_native);
#endif

  if (store.load(private_key_)) {
    freshly_commissioned_ = false;
    if (!derivePublicKey(private_key_, public_key_)) return false;
    if (!deriveAddress(public_key_, address_)) return false;
    return true;
  }

  freshly_commissioned_ = true;
  bool generated = false;
  for (int attempt = 0; attempt < 16; ++attempt) {
#ifndef KRISHI_NATIVE
    for (int i = 0; i < 32; ++i) {
      private_key_[i] = static_cast<uint8_t>(esp_random() & 0xFF);
    }
#else
    for (int i = 0; i < 32; ++i) {
      static uint32_t state = 123456789 + rand();
      state = state * 1103515245 + 12345;
      private_key_[i] = static_cast<uint8_t>((state >> 16) & 0xFF);
    }
#endif
    if (derivePublicKey(private_key_, public_key_) && deriveAddress(public_key_, address_)) {
      generated = true;
      break;
    }
  }

  if (!generated) return false;
  if (!store.save(private_key_)) return false;

  // Print public key and address on commissioning (NEVER private key!)
  char addrHex[43];
  toHex(address_, kAddressLength, addrHex, sizeof(addrHex));
  char pubHex[131];
  toHex(public_key_, 65, pubHex, sizeof(pubHex));
  printf("[IDENTITY] Commissioned new device identity:\n  Address: %s\n  PubKey:  %s\n",
         addrHex, pubHex);

  return true;
}

bool Identity::begin() {
#ifndef KRISHI_NATIVE
  NvsKeyStore store;
  return begin(store);
#else
  static MemoryKeyStore defaultHostStore;
  return begin(defaultHostStore);
#endif
}

void Identity::digest(const uint8_t* data, size_t length, uint8_t out[kDigestLength]) {
  keccak256(data, length, out);
}

bool Identity::sign(const uint8_t digest_in[kDigestLength], uint8_t out[kSignatureLength]) const {
  return signDigest(private_key_, digest_in, out);
}

bool Identity::signRecord(const Record& record, uint8_t out[kSignatureLength]) const {
  uint8_t canonical[kCanonicalLength];
  if (encodeRecord(record, canonical, sizeof(canonical)) != kCanonicalLength) {
    return false;
  }
  uint8_t d[kDigestLength];
  digest(canonical, sizeof(canonical), d);
  return sign(d, out);
}

bool Identity::erase() {
#ifndef KRISHI_NATIVE
  NvsKeyStore store;
  return store.clear();
#else
  static MemoryKeyStore defaultHostStore;
  return defaultHostStore.clear();
#endif
}

}  // namespace krishi
