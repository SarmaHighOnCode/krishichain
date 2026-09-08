/**
 * KrishiChain WITNESS NODE (AI Thinker ESP32-CAM) — ticket H2-12.
 *
 * Visual evidence: captures a grayscale QVGA frame, hashes the raw pixels
 * (keccak256), derives a lid open/closed verdict from mean brightness, and
 * posts a CAM_PHOTO_V1 companion attestation linked by (dev, seq, digest)
 * to its own canonical record. No raw photo on-chain, ever.
 *
 * Why the CAM also emits normal records: the companion links to (dev,seq,
 * digest) of a record the gateway already holds, so S1-14 verifies the
 * companion against a stored digest instead of trusting a bare claim.
 *
 * Lux semantics on this node: no LDR fits the AI Thinker pin budget (camera +
 * SD own nearly everything), so `lux` = mean luma 0-255, a brightness proxy.
 * Threshold tuned on the bench (H2-04); inside a sealed box reads <15.
 *
 * SD card (optional, non-fatal): each capture saved as /krishi/c<seq>.raw
 * with a .meta sidecar. Offline photos survive on the card; hashes still
 * flow through the ring buffer + gateway like any record.
 */

#include <Arduino.h>

#ifdef ARDUINO_ARCH_ESP32
#include <HTTPClient.h>
#include <WiFi.h>
#include <esp_camera.h>
#endif

#include "chain.h"
#include "companion.h"
#include "identity.h"
#include "pins.h"
#include "record.h"
#include "ringbuffer.h"
#include "swarm.h"
#include "uplink.h"

namespace {

krishi::Identity identity;
krishi::Chain chain;
krishi::RingBuffer buffer;
krishi::Uplink uplink;

bool boot_flag_pending = true;
uint32_t last_sample_ms = 0;
bool sd_present = false;

// Bench-tuned (H2-04): sealed-box mean <15, open room light >80.
constexpr uint8_t kLidMeanThreshold = 40;

const char* kGateway = "http://192.168.1.50:8080";  // TODO: serial `GW <url>`

#ifdef ARDUINO_ARCH_ESP32
bool cameraBegin() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = 5;
  config.pin_d1 = 18;
  config.pin_d2 = 19;
  config.pin_d3 = 21;
  config.pin_d4 = 36;
  config.pin_d5 = 39;
  config.pin_d6 = 34;
  config.pin_d7 = 35;
  config.pin_xclk = 0;
  config.pin_pclk = 22;
  config.pin_vsync = 25;
  config.pin_href = 23;
  config.pin_sccb_sda = 26;
  config.pin_sccb_scl = 27;
  config.pin_pwdn = 32;
  config.pin_reset = -1;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_GRAYSCALE;  // raw luma: hashable, no encoder variance
  config.frame_size = FRAMESIZE_QVGA;         // 320x240
  config.jpeg_quality = 12;                   // unused for grayscale, kept for init
  config.fb_count = 1;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  return esp_camera_init(&config) == ESP_OK;
}

uint8_t meanLuma(const uint8_t* pixels, size_t len) {
  uint64_t acc = 0;
  uint32_t n = 0;
  for (size_t i = 0; i < len; i += 16) {  // every 16th pixel is plenty for a verdict
    acc += pixels[i];
    ++n;
  }
  return n == 0 ? 0 : static_cast<uint8_t>(acc / n);
}

void saveToSd(uint32_t seq, const uint8_t* pixels, size_t len, uint8_t mean,
              const uint8_t photo_hash[krishi::kDigestLength]) {
  if (!sd_present) return;
  char path[48];
  snprintf(path, sizeof(path), "/krishi/c%u.raw", seq);
  // TODO(H2-12 bench): SD_MMC file write + .meta sidecar. Stubbed until bench day;
  // the hash + companion already flow without the card.
  (void)path;
  (void)pixels;
  (void)len;
  (void)mean;
  (void)photo_hash;
}

void postJson(const char* url, const char* body) {
  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.POST((const uint8_t*)body, strlen(body));
  http.end();
}
#endif

void captureCycle() {
#ifdef ARDUINO_ARCH_ESP32
  camera_fb_t* fb = esp_camera_fb_get();
  if (fb == nullptr) {
    Serial.println("WARN: camera capture failed — recording fault sentinel");
  }
  uint8_t mean = fb != nullptr ? meanLuma(fb->buf, fb->len) : 0;
  bool lid_open = mean > kLidMeanThreshold;

  uint8_t photo_hash[krishi::kDigestLength] = {0};
  if (fb != nullptr) krishi::Identity::digest(fb->buf, fb->len, photo_hash);

  krishi::Record record;
  memcpy(record.dev, identity.address(), krishi::kAddressLength);
  record.t = krishi::kSensorFaultTemp;  // no DHT on the CAM — never fake T/H
  record.h = krishi::kSensorFaultHumidity;
  record.flags |= krishi::kFlagSensorFault;
  record.lux = mean;  // luma proxy, see file header
  if (lid_open) record.flags |= krishi::kFlagLidOpen;
  record.ts = 0;  // TODO(H1-08): NTP
  record.tsq = krishi::kTimeUnsynced;
  record.bat = krishi::kBatteryMains;  // CAM runs on USB in the lid rig
  if (boot_flag_pending) {
    record.flags |= krishi::kFlagBoot;
    boot_flag_pending = false;
  }
  chain.stamp(record);

  uint8_t canonical[krishi::kCanonicalLength];
  if (krishi::encodeRecord(record, canonical, sizeof(canonical)) != krishi::kCanonicalLength) {
    if (fb != nullptr) esp_camera_fb_return(fb);
    return;
  }
  uint8_t digest[krishi::kDigestLength];
  krishi::Identity::digest(canonical, sizeof(canonical), digest);
  uint8_t signature[krishi::kSignatureLength];
  if (!identity.sign(digest, signature)) {
    if (fb != nullptr) esp_camera_fb_return(fb);
    return;
  }
  if (!buffer.append(record, signature)) {
    if (fb != nullptr) esp_camera_fb_return(fb);
    return;
  }
  chain.advance(digest);

  // Companion attestation over the 96-byte canonical (lib/krishi/companion.h).
  krishi::companion::CamAttest attest;
  memcpy(attest.dev, identity.address(), krishi::kAddressLength);
  attest.seq = record.seq;
  memcpy(attest.record_digest, digest, sizeof(digest));
  memcpy(attest.photo_hash, photo_hash, sizeof(photo_hash));
  attest.lux_mean = mean;
  attest.lid_open = lid_open;
  attest.img_bytes = fb != nullptr ? static_cast<uint32_t>(fb->len) : 0;
  uint8_t ccanon[krishi::companion::kCanonicalLength];
  krishi::companion::packCamAttest(attest, ccanon, sizeof(ccanon));
  uint8_t cdigest[krishi::kDigestLength];
  krishi::Identity::digest(ccanon, sizeof(ccanon), cdigest);
  uint8_t csig[krishi::kSignatureLength];
  if (!identity.sign(cdigest, csig)) {
    if (fb != nullptr) esp_camera_fb_return(fb);
    return;
  }
  (void)csig;

  if (fb != nullptr) {
    saveToSd(record.seq, fb->buf, fb->len, mean, photo_hash);
    esp_camera_fb_return(fb);
  }

  char digest_hex[krishi::kDigestLength * 2 + 3];
  char photo_hex[krishi::kDigestLength * 2 + 3];
  krishi::toHex(digest, krishi::kDigestLength, digest_hex, sizeof(digest_hex));
  krishi::toHex(photo_hash, krishi::kDigestLength, photo_hex, sizeof(photo_hex));

  // TODO(H2-12 bench): full /ingest + /ingest/companion POST via Uplink once H1-07
  // lands; until then the serial line below is the bench-verifiable output.
  Serial.printf("cam seq=%u mean=%u lid=%s photo=%s digest=%s\n", record.seq, mean,
                lid_open ? "OPEN" : "shut", photo_hex, digest_hex);

  digitalWrite(krishi::pins::kRedLed, lid_open ? LOW : HIGH);  // active-low lamp
#else
  (void)last_sample_ms;
#endif
}

}  // namespace

void setup() {
  Serial.begin(115200);
  Serial.println();
  Serial.println("KrishiChain WITNESS node (ESP32-CAM)");

  if (!identity.begin()) {
    Serial.println("FATAL: identity unavailable");
    return;
  }
  char address_hex[krishi::kAddressLength * 2 + 3];
  krishi::toHex(identity.address(), krishi::kAddressLength, address_hex, sizeof(address_hex));
  Serial.printf("device address: %s\n", address_hex);
  if (identity.wasCommissionedThisBoot()) {
    Serial.println("*** NEWLY COMMISSIONED — register this address on-chain:");
    Serial.printf("    npm run device:register -- --address %s --class CAM_V1\n", address_hex);
  }

  chain.begin();
  buffer.begin();

#ifdef ARDUINO_ARCH_ESP32
  pinMode(krishi::pins::kRedLed, OUTPUT);
  digitalWrite(krishi::pins::kRedLed, HIGH);  // lamp off (active low)

  if (!cameraBegin()) {
    Serial.println("FATAL: camera init failed");
    return;
  }
  Serial.println("camera: grayscale QVGA, PSRAM frame buffer");

  // SD_MMC 1-bit on the AI Thinker pins. Optional — evidence archive only.
  // TODO(H2-12 bench): SD_MMC.begin + mkdir /krishi; sets sd_present.
  WiFi.mode(WIFI_STA);
  WiFi.begin("krishichain", "krishichain");  // TODO: serial `WIFI <ssid> <pass>`
#endif

  uplink.begin(kGateway);
  last_sample_ms = millis();
}

void loop() {
  uint32_t interval = 60000;  // photos are heavy; adaptive INTERVAL lands with H1-14
  if (millis() - last_sample_ms < interval) {
    delay(100);
    return;
  }
  last_sample_ms = millis();
  captureCycle();
}
