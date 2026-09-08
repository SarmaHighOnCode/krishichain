#include <Arduino.h>
#include <WiFi.h>
#include <esp_camera.h>

static const char* kSsid = "Debyte";
static const char* kPass = "123456789";

static bool cameraBegin() {
  camera_config_t c;
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer = LEDC_TIMER_0;
  c.pin_d0 = 5;
  c.pin_d1 = 18;
  c.pin_d2 = 19;
  c.pin_d3 = 21;
  c.pin_d4 = 36;
  c.pin_d5 = 39;
  c.pin_d6 = 34;
  c.pin_d7 = 35;
  c.pin_xclk = 0;
  c.pin_pclk = 22;
  c.pin_vsync = 25;
  c.pin_href = 23;
  c.pin_sccb_sda = 26;
  c.pin_sccb_scl = 27;
  c.pin_pwdn = 32;
  c.pin_reset = -1;
  c.xclk_freq_hz = 20000000;
  c.pixel_format = PIXFORMAT_JPEG;
  c.frame_size = FRAMESIZE_QVGA;
  c.jpeg_quality = 12;
  c.fb_count = 1;
  c.fb_location = CAMERA_FB_IN_PSRAM;
  c.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  return esp_camera_init(&c) == ESP_OK;
}

void setup() {
  Serial.begin(115200);
  Serial.println();
  Serial.println("node-cam ok");

  WiFi.mode(WIFI_STA);
  WiFi.begin(kSsid, kPass);
  Serial.print("wifi: connecting to Debyte");
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("wifi: connected ip=%s rssi=%d ch=%d\n", WiFi.localIP().toString().c_str(),
                  WiFi.RSSI(), WiFi.channel());
  } else {
    Serial.printf("wifi: FAILED status=%d (check ssid/pass)\n", (int)WiFi.status());
  }

  if (!cameraBegin()) {
    Serial.println("camera: FAILED");
  } else {
    Serial.println("camera: ok");
  }
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    static uint32_t last_try = 0;
    if (millis() - last_try > 10000) {
      last_try = millis();
      WiFi.disconnect(true);
      WiFi.mode(WIFI_STA);
      WiFi.begin(kSsid, kPass);
      Serial.println("wifi: retrying Debyte...");
    }
    delay(200);
    return;
  }

  static uint32_t last_cap = 0;
  if (millis() - last_cap < 10000) {
    delay(100);
    return;
  }
  last_cap = millis();

  camera_fb_t* fb = esp_camera_fb_get();
  if (fb == nullptr) {
    Serial.println("cap: FAILED");
    return;
  }
  Serial.printf("cap: bytes=%u wifi=%s ip=%s\n", (unsigned)fb->len,
                WiFi.status() == WL_CONNECTED ? "up" : "down",
                WiFi.localIP().toString().c_str());
  esp_camera_fb_return(fb);
}
