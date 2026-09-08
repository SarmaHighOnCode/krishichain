/**
 * KrishiChain CAM BRING-UP — standalone ESP32-CAM smoke test.
 *
 * Purpose: prove YOUR board, YOUR cable, YOUR SD card, and YOUR pio setup
 * before the krishi witness firmware (node-cam) enters the picture.
 *
 * ZERO krishi dependencies: plain Arduino + esp_camera + SD_MMC only. If this
 * does not build/flash/capture, the problem is the toolchain or the board —
 * not our protocol code. Do not debug node-cam until this passes.
 *
 * What it does, every 10 s:
 *   1. grabs a grayscale QVGA frame (same config as node-cam)
 *   2. prints mean brightness + size to serial (the lid-verdict signal)
 *   3. writes /bringup/c<boot-count>.raw + a .txt sidecar when the SD mounts
 *
 * Expected serial (115200):
 *   cam-bringup ok
 *   camera: OV2640 ... / sd: 1234 MB free (or "sd: MOUNT FAILED ..." — non-fatal here)
 *   cap #0 mean=87 bytes=76800 sd=ok
 *   cap #1 mean=12 bytes=76800 sd=ok     <- cover the lens, watch it drop
 */

#include <Arduino.h>

#ifdef ARDUINO_ARCH_ESP32
#include <SD_MMC.h>
#include <esp_camera.h>
#endif

namespace {

unsigned cap_no = 0;
bool sd_ok = false;

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
  config.pixel_format = PIXFORMAT_GRAYSCALE;
  config.frame_size = FRAMESIZE_QVGA;
  config.jpeg_quality = 12;
  config.fb_count = 1;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  return esp_camera_init(&config) == ESP_OK;
}

uint8_t meanLuma(const uint8_t* pixels, size_t len) {
  uint64_t acc = 0;
  uint32_t n = 0;
  for (size_t i = 0; i < len; i += 16) {
    acc += pixels[i];
    ++n;
  }
  return n == 0 ? 0 : static_cast<uint8_t>(acc / n);
}
#endif

}  // namespace

void setup() {
  Serial.begin(115200);
  Serial.println();
  Serial.println("cam-bringup ok");

#ifdef ARDUINO_ARCH_ESP32
  pinMode(33, OUTPUT);  // AI Thinker red lamp, active low
  digitalWrite(33, HIGH);

  sensor_t* s = nullptr;
  if (!cameraBegin()) {
    Serial.println("FATAL: camera init failed — check board = esp32cam, flash + PSRAM");
    return;
  }
  s = esp_camera_sensor_get();
  Serial.printf("camera: %s QVGA grayscale, PSRAM frame buffer\n",
                s != nullptr ? "OV2640" : "unknown sensor");

  SD_MMC.setPins(/*clk=*/14, /*cmd=*/15, /*d0=*/2);
  sd_ok = SD_MMC.begin("/sdcard", true);
  if (!sd_ok) {
    Serial.println("sd: MOUNT FAILED — captures still print, nothing is archived");
  } else {
    if (!SD_MMC.exists("/bringup")) SD_MMC.mkdir("/bringup");
    Serial.printf("sd: %llu MB free\n",
                  (SD_MMC.totalBytes() - SD_MMC.usedBytes()) / (1024ULL * 1024ULL));
  }
#endif
}

void loop() {
#ifdef ARDUINO_ARCH_ESP32
  camera_fb_t* fb = esp_camera_fb_get();
  if (fb == nullptr) {
    Serial.println("cap FAILED (null frame buffer)");
    delay(10000);
    return;
  }
  uint8_t mean = meanLuma(fb->buf, fb->len);

  bool archived = false;
  if (sd_ok) {
    char raw_path[48];
    char txt_path[48];
    snprintf(raw_path, sizeof(raw_path), "/bringup/c%u.raw", cap_no);
    snprintf(txt_path, sizeof(txt_path), "/bringup/c%u.txt", cap_no);
    File raw = SD_MMC.open(raw_path, FILE_WRITE);
    if (raw) {
      raw.write(fb->buf, fb->len);
      raw.close();
      File txt = SD_MMC.open(txt_path, FILE_WRITE);
      if (txt) {
        txt.printf("cap=%u\nmean=%u\nbytes=%u\n", cap_no, mean,
                   static_cast<unsigned>(fb->len));
        txt.close();
        archived = true;
      }
    }
  }

  Serial.printf("cap #%u mean=%u bytes=%u sd=%s\n", cap_no, mean,
                static_cast<unsigned>(fb->len), archived ? "ok" : "skip");
  digitalWrite(33, mean > 40 ? LOW : HIGH);  // lamp on when "lid open" bright
  esp_camera_fb_return(fb);
  ++cap_no;
#endif
  delay(10000);
}
