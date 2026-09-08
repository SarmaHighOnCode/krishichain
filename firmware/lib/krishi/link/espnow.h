#pragma once
/**
 * ESP-NOW transport driver for HEAD and LEAF nodes.
 * See docs/PROTOCOL-LINK.md section 3 & 4 and docs/adr/0005-espnow-link-protocol.md.
 */

#include <stdint.h>
#include <stddef.h>

#ifndef KRISHI_NATIVE
#include <esp_now.h>
#include <esp_wifi.h>
#if __has_include(<esp_arduino_version.h>)
#include <esp_arduino_version.h>
#endif

// Arduino-ESP32 3.x (ESP-IDF 5.x) changed the receive callback signature from
// (const uint8_t* mac, ...) to (const esp_now_recv_info_t* src, ...).
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
#define KRISHI_RECV_FN(fn) \
  void fn(const esp_now_recv_info_t* src, const uint8_t* data, int len)
#define KRISHI_SRC_MAC(src) ((src)->src_addr)
#else
#define KRISHI_RECV_FN(fn) void fn(const uint8_t* src, const uint8_t* data, int len)
#define KRISHI_SRC_MAC(src) (src)
#endif
#endif

#include "frame.h"
#include "swarm.h"

namespace krishi {

struct ReceivedFrame {
  uint8_t mac[6];
  uint8_t data[kMaxFrameLength];
  uint8_t len;
};

/**
 * True if `data` is a frame either wire protocol this project speaks would parse:
 * link/frame.h's own format (magic 0x4B, version 0x01) or swarm.h's (magic 0x4B43,
 * see docs/adr/0005-espnow-link-protocol.md section 7 for why both coexist on the
 * wire without colliding — different magic bytes, so each format's own parser
 * already rejects the other's frames; this just decides what the radio callback
 * queues at all, versus a stray frame from an unrelated ESP-NOW project on the
 * same channel).
 *
 * Pure and host-testable even though the callback that calls it only runs on
 * device — that split is deliberate, see firmware/test/test_espnow_dispatch.
 */
bool isRecognizedFrame(const uint8_t* data, size_t len);

class EspNowLink {
 public:
  EspNowLink() = default;

  bool beginHead(uint8_t channel);
  bool beginLeaf();

  bool addPeer(const uint8_t mac[6], uint8_t channel, bool encrypt = false);
  bool send(const uint8_t mac[6], const uint8_t* frame, size_t len);
  bool broadcast(const uint8_t* frame, size_t len);

  bool pop(ReceivedFrame& out);

  uint8_t channel() const { return channel_; }
  uint32_t droppedForeign() const;
  uint32_t queueOverflows() const;

 private:
  uint8_t channel_ = 1;
};

}  // namespace krishi
