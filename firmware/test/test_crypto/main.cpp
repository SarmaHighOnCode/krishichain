#include <unity.h>

// Keccak tests
void test_keccak_empty_input();
void test_keccak_abc();
void test_keccak_200_bytes();
void test_keccak_golden_vectors();

// Signer tests
void test_address_matches_vectors();
void test_public_key_is_uncompressed();
void test_every_signature_is_low_s();
void test_signing_is_deterministic();
void test_signature_verifies_with_uecc();

// Identity tests
void test_first_boot_generates_and_persists();
void test_two_devices_get_different_identities();
void test_sign_record_matches_manual_digest_then_sign();

void setUp(void) {}
void tearDown(void) {}

int main(int argc, char** argv) {
  UNITY_BEGIN();

  // Keccak256
  RUN_TEST(test_keccak_empty_input);
  RUN_TEST(test_keccak_abc);
  RUN_TEST(test_keccak_200_bytes);
  RUN_TEST(test_keccak_golden_vectors);

  // Signer
  RUN_TEST(test_address_matches_vectors);
  RUN_TEST(test_public_key_is_uncompressed);
  RUN_TEST(test_every_signature_is_low_s);
  RUN_TEST(test_signing_is_deterministic);
  RUN_TEST(test_signature_verifies_with_uecc);

  // Identity
  RUN_TEST(test_first_boot_generates_and_persists);
  RUN_TEST(test_two_devices_get_different_identities);
  RUN_TEST(test_sign_record_matches_manual_digest_then_sign);

  return UNITY_END();
}
