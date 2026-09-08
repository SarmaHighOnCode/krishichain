#pragma once
/**
 * Device identity — ticket H1-02. THE most important file in the firmware.
 *
 * The whole project rests on one claim: this key was generated on this chip and has never
 * left it. If the key can be exported, KrishiChain is just an expensive logger (ADR-0001).
 *
 * Rules, non-negotiable:
 *   1. Generate from the hardware TRNG (`esp_random()`), never from millis(), the MAC
 *      address, or anything else an attacker can guess or replay across devices.
 *   2. Store in NVS with flash encryption enabled.
 *   3. Print the PUBLIC key and address exactly once, at commissioning. Never the private key.
 *   4. Address = keccak256(uncompressedPubkey[1:])[12:]. Drop the 0x04 prefix byte first —
 *      forgetting that slice yields a plausible-looking address that never matches the
 *      gateway's, and it is the single most common bug in device-identity code.
 */

#include <stddef.h>
#include <stdint.h>

#include "record.h"

namespace krishi {

class KeyStore {
 public:
  virtual ~KeyStore() = default;
  virtual bool load(uint8_t privateKey[32]) = 0;
  virtual bool save(const uint8_t privateKey[32]) = 0;
  virtual bool clear() = 0;
};

class MemoryKeyStore : public KeyStore {
 public:
  bool load(uint8_t privateKey[32]) override;
  bool save(const uint8_t privateKey[32]) override;
  bool clear() override;

 private:
  uint8_t key_[32] = {0};
  bool hasKey_ = false;
};

class NvsKeyStore : public KeyStore {
 public:
  bool load(uint8_t privateKey[32]) override;
  bool save(const uint8_t privateKey[32]) override;
  bool clear() override;
};

class Identity {
 public:
  /**
   * Load the key from specified store, or generate and persist one on first boot.
   * @return true if the device has a usable identity afterwards.
   */
  bool begin(KeyStore& store);

  /** Convenience overload using default NvsKeyStore (device) or MemoryKeyStore (host). */
  bool begin();

  /** True if this boot generated a fresh identity (i.e. the node was just commissioned). */
  bool wasCommissionedThisBoot() const { return freshly_commissioned_; }

  const uint8_t* address() const { return address_; }        // 20 bytes
  const uint8_t* publicKey() const { return public_key_; }   // 65 bytes, uncompressed

  /** keccak256 over `length` bytes of `data`. Output is 32 bytes. */
  static void digest(const uint8_t* data, size_t length, uint8_t out[kDigestLength]);

  /**
   * Sign a 32-byte digest. Deterministic (RFC 6979), with `s` normalised to the lower half
   * of the curve order — high-`s` signatures are valid ECDSA but malleable, which breaks
   * deduplication on the gateway.
   * @param out 64 bytes: r || s.
   */
  bool sign(const uint8_t digest_in[kDigestLength], uint8_t out[kSignatureLength]) const;

  /** Convenience: canonical-encode, digest and sign in one step. */
  bool signRecord(const Record& record, uint8_t out[kSignatureLength]) const;

  /** Erase stored identity using default KeyStore. */
  static bool erase();

 private:
  uint8_t private_key_[32] = {0};
  uint8_t public_key_[65] = {0};
  uint8_t address_[kAddressLength] = {0};
  bool freshly_commissioned_ = false;
};

}  // namespace krishi
