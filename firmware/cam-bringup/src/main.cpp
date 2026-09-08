/**
 * KrishiChain CAM BRING-UP — standalone ESP32-CAM smoke test.
 *
 * Purpose: prove YOUR board, YOUR cable, YOUR SD card, and YOUR pio setup
 * before the krishi witness firmware (node-cam) enters the picture.
 *
 * ZERO krishi dependencies: plain Arduino + camera webserver-style capture.
 * If this does not build/flash/capture, the problem is the toolchain or the
 * board — not our protocol code. Do not debug node-cam until this passes.
 *
 * What it does:
 *   1. connects to WiFi, starts a web page on http://<ip>/ showing the LIVE
 *      feed + a Capture button (this is how you SEE what the camera sees)
 *   2. every 10 s also saves one JPEG to /bringup/c<N>.jpg on the SD card,
 *      which opens in any photo viewer — plus mean brightness on serial
 *      (the lid-verdict signal: bright room vs dark sealed box)
 *   3. white flash LED (GPIO4) is OFF by default and toggled on demand
 *      (serial FLASH / NOFLASH, or the web page link). Reason: the lid
 *      verdict reads AMBIENT light — firing the flash inside a sealed box
 *      lights it up and every capture reads "OPEN". Flash is for seeing
 *      inside the dark, verdict is for knowing it was dark. Never both
 *      on the same frame.
 *   SD runs in 1-bit mode (CLK 14 / CMD 15 / D0 2) — this is what FREES
 *   GPIO4 for the flash. In 4-bit mode GPIO4 becomes SD DATA1 and the
 *   flash + SD fight each other. Cost of 1-bit is ~4x slower writes,
 *   irrelevant at one JPEG per 10 s.
 *
 * Expected serial (115200):
 *   cam-bringup ok
 *   camera: OV2640 ... / sd: 1234 MB free / wifi: 192.168.x.x  <-- OPEN THIS IP
 *   cap #0 mean=87 bytes=12345 sd=ok
 *   cap #1 mean=12 bytes=11890 sd=ok     <- cover the lens, watch it drop
 */

#include <Arduino.h>

#ifdef ARDUINO_ARCH_ESP32
#include <SD_MMC.h>
#include <WebServer.h>
#include <WiFi.h>
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
  config.pixel_format = PIXFORMAT_JPEG;  // viewable .jpg, not raw pixels
  config.frame_size = FRAMESIZE_SVGA;    // 800x600 — readable, still small
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

// JPEG bytes are compressed, so a true luma mean needs a decode. This samples
// chunk averages instead — good enough to tell "bright room" from "dark box".
uint8_t jpegBrightness(const uint8_t* jpg, size_t len) {
  if (jpg == nullptr || len < 64) return 0;
  uint64_t acc = 0;
  uint32_t n = 0;
  for (size_t i = 32; i + 8 < len; i += 257) {
    uint32_t chunk = 0;
    for (size_t j = 0; j < 8; ++j) chunk += jpg[i + j];
    acc += chunk / 8;
    ++n;
  }
  return n == 0 ? 0 : static_cast<uint8_t>(acc / n);
}
#endif

}  // namespace

#ifdef ARDUINO_ARCH_ESP32
const char* kWifiSsid = "krishichain";  // TODO: serial `WIFI <ssid> <pass>`
const char* kWifiPass = "krishichain";
uint8_t last_mean = 0;
uint32_t last_bytes = 0;
bool flash_on = false;  // white LED GPIO4 — OFF unless asked (see header)
WebServer* server = nullptr;

void setFlash(bool on) {
  flash_on = on;
  digitalWrite(4, on ? HIGH : LOW);
}

void handleRoot() {
  char html[1152];
  snprintf(html, sizeof(html),
           "<html><head><meta http-equiv='refresh' content='5'></head><body>"
           "<h2>KrishiChain CAM bring-up</h2>"
           "<p>last cap #%u: brightness=%u bytes=%u flash=%s</p>"
           "<p><a href='/flash'>toggle flash</a> (white LED, for seeing in the dark)</p>"
           "<img src='/shot.jpg' style='max-width:100%%'>"
           "<p><a href='/shot.jpg'>full capture</a> (refreshes every 5 s)</p>"
           "</body></html>",
           cap_no == 0 ? 0 : cap_no - 1, last_mean, last_bytes, flash_on ? "ON" : "off");
  server->send(200, "text/html", html);
}

void handleFlash() {
  setFlash(!flash_on);
  Serial.printf("flash %s\n", flash_on ? "ON" : "off");
  server->sendHeader("Location", "/");
  server->send(303, "text/plain", "");
}

void handleShot() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (fb == nullptr) {
    server->send(503, "text/plain", "capture failed");
    return;
  }
  server->setContentLength(fb->len);
  server->send(200, "image/jpeg", "");
  server->sendContent(reinterpret_cast<const char*>(fb->buf), fb->len);
  esp_camera_fb_return(fb);
}
#endif

void setup() {
  Serial.begin(115200);
  Serial.println();
  Serial.println("cam-bringup ok");

#ifdef ARDUINO_ARCH_ESP32
  pinMode(33, OUTPUT);  // AI Thinker red lamp, active low
  digitalWrite(33, HIGH);
  pinMode(4, OUTPUT);  // white flash LED — starts OFF (see header)
  digitalWrite(4, LOW);

  sensor_t* s = nullptr;
  if (!cameraBegin()) {
    Serial.println("FATAL: camera init failed — check board = esp32cam, flash + PSRAM");
    return;
  }
  s = esp_camera_sensor_get();
  Serial.printf("camera: %s JPEG SVGA, PSRAM frame buffer\n",
                s != nullptr ? "OV2640" : "unknown sensor");

  SD_MMC.setPins(/*clk=*/14, /*cmd=*/15, /*d0=*/2);  // 1-bit: frees GPIO4 for flash
  sd_ok = SD_MMC.begin("/sdcard", true);
  if (!sd_ok) {
    Serial.println("sd: MOUNT FAILED — captures still print, nothing is archived");
  } else {
    if (!SD_MMC.exists("/bringup")) SD_MMC.mkdir("/bringup");
    Serial.printf("sd: %llu MB free\n",
                  (SD_MMC.totalBytes() - SD_MMC.usedBytes()) / (1024ULL * 1024ULL));
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(kWifiSsid, kWifiPass);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; ++i) delay(250);
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("wifi: %s — open it for the LIVE feed\n", WiFi.localIP().toString().c_str());
    server = new WebServer(80);
    server->on("/", handleRoot);
    server->on("/shot.jpg", handleShot);
    server->on("/flash", handleFlash);
    server->begin();
  } else {
    Serial.println("wifi: FAILED — SD captures continue, no live page");
  }
#endif
}

bool archiveJpeg(unsigned no, const uint8_t* jpg, size_t len, uint8_t mean) {
  if (!sd_ok || jpg == nullptr || len == 0) return false;
  char jpg_path[48];
  char txt_path[48];
  snprintf(jpg_path, sizeof(jpg_path), "/bringup/c%u.jpg", no);
  snprintf(txt_path, sizeof(txt_path), "/bringup/c%u.txt", no);
  File out = SD_MMC.open(jpg_path, FILE_WRITE);
  if (!out) return false;
  out.write(jpg, len);
  out.close();
  File txt = SD_MMC.open(txt_path, FILE_WRITE);
  if (!txt) return false;
  txt.printf("cap=%u\nmean=%u\nbytes=%u\n", no, mean, static_cast<unsigned>(len));
  txt.close();
  return true;
}

void loop() {
#ifdef ARDUINO_ARCH_ESP32
  if (server != nullptr) server->handleClient();

  // Serial bench controls: FLASH / NOFLASH toggle the white LED.
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    cmd.toUpperCase();
    if (cmd == "FLASH") {
      setFlash(true);
      Serial.println("flash ON — verdict frames will read bright, use for seeing only");
    } else if (cmd == "NOFLASH") {
      setFlash(false);
      Serial.println("flash off — verdict reads ambient again");
    }
  }

  static uint32_t last_cap_ms = 0;
  if (millis() - last_cap_ms < 10000) {
    delay(50);
    return;
  }
  last_cap_ms = millis();

  camera_fb_t* fb = esp_camera_fb_get();
  if (fb == nullptr) {
    Serial.println("cap FAILED (null frame buffer)");
    return;
  }
  uint8_t mean = jpegBrightness(fb->buf, fb->len);
  last_mean = mean;
  last_bytes = static_cast<uint32_t>(fb->len);

  bool archived = archiveJpeg(cap_no, fb->buf, fb->len, mean);

  Serial.printf("cap #%u mean=%u bytes=%u sd=%s\n", cap_no, mean,
                static_cast<unsigned>(fb->len), archived ? "ok" : "skip");
  digitalWrite(33, mean > 40 ? LOW : HIGH);  // lamp on when "lid open" bright
  esp_camera_fb_return(fb);
  ++cap_no;
#else
  delay(10000);
#endif
}
