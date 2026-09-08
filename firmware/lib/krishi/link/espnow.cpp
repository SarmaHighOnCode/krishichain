#include "espnow.h"
#include <string.h>

#ifndef KRISHI_NATIVE
#include <WiFi.h>
#include <Preferences.h>
#endif

namespace krishi {

namespace {

constexpr size_t kRxQueueSize = 16;
static ReceivedFrame rxQueue[kRxQueueSize];
static volatile size_t rxHead = 0;
static volatile size_t rxTail = 0;
static volatile uint32_t gDroppedForeign = 0;
static volatile uint32_t gQueueOverflows = 0;

static const uint8_t kBroadcastMac[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
static const uint8_t kDefaultPmk[16] = {'K', 'R', 'I', 'S', 'H', 'I', 'C', 'H', 'A', 'I', 'N', '_', 'P', 'M', 'K', '!'};

#ifndef KRISHI_NATIVE
KRISHI_RECV_FN(onEspNowRecv) {
  if (len <= 0 || static_cast<size_t>(len) > kMaxFrameLength) return;
  if (!isRecognizedFrame(data, static_cast<size_t>(len))) {
    gDroppedForeign++;
    return;
  }

  const size_t next = (rxHead + 1) % kRxQueueSize;
  if (next == rxTail) {
    gQueueOverflows++;
    return;
  }

  memcpy(rxQueue[rxHead].mac, KRISHI_SRC_MAC(src), 6);
  memcpy(rxQueue[rxHead].data, data, static_cast<size_t>(len));
  rxQueue[rxHead].len = static_cast<uint8_t>(len);
  rxHead = next;
}
#endif

}  // namespace

bool isRecognizedFrame(const uint8_t* data, size_t len) {
  if (frameType(data, len) != 0) return true;
  if (len == swarm::kRecordFrameLength || len == swarm::kHeartbeatLength) {
    const uint16_t magic = (static_cast<uint16_t>(data[0]) << 8) | data[1];
    return magic == swarm::kMagic;
  }
  return false;
}

uint32_t EspNowLink::droppedForeign() const { return gDroppedForeign; }
uint32_t EspNowLink::queueOverflows() const { return gQueueOverflows; }

bool EspNowLink::pop(ReceivedFrame& out) {
  if (rxHead == rxTail) return false;
  out = rxQueue[rxTail];
  rxTail = (rxTail + 1) % kRxQueueSize;
  return true;
}

bool EspNowLink::beginHead(uint8_t channel) {
  channel_ = channel;
#ifndef KRISHI_NATIVE
  if (esp_now_init() != ESP_OK) return false;
  esp_now_register_recv_cb(onEspNowRecv);
  esp_now_set_pmk(kDefaultPmk);

  esp_now_peer_info_t peer{};
  memcpy(peer.peer_addr, kBroadcastMac, 6);
  peer.channel = channel_;
  peer.encrypt = false;
  esp_now_add_peer(&peer);
#endif
  return true;
}

bool EspNowLink::beginLeaf() {
#ifndef KRISHI_NATIVE
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();

  Preferences prefs;
  prefs.begin("krishi_link", true);
  uint8_t savedChan = prefs.getUChar("chan", 0);
  uint8_t savedMac[6];
  size_t macLen = prefs.getBytes("head_mac", savedMac, 6);
  prefs.end();

  if (savedChan >= 1 && savedChan <= 13 && macLen == 6) {
    channel_ = savedChan;
    esp_wifi_set_channel(channel_, WIFI_SECOND_CHAN_NONE);
    if (esp_now_init() == ESP_OK) {
      esp_now_register_recv_cb(onEspNowRecv);
      addPeer(savedMac, channel_, false);
      return true;
    }
  }

  // Scan channels 1..13 for BEACON
  if (esp_now_init() != ESP_OK) return false;
  esp_now_register_recv_cb(onEspNowRecv);

  for (uint8_t ch = 1; ch <= 13; ++ch) {
    esp_wifi_set_channel(ch, WIFI_SECOND_CHAN_NONE);
    uint32_t start = millis();
    while (millis() - start < 200) {
      ReceivedFrame f;
      if (pop(f)) {
        if (frameType(f.data, f.len) == kFrameBeacon) {
          BeaconFrame b;
          if (decodeBeaconFrame(f.data, f.len, b)) {
            channel_ = ch;
            addPeer(f.mac, channel_, false);
            Preferences pWrite;
            pWrite.begin("krishi_link", false);
            pWrite.putUChar("chan", ch);
            pWrite.putBytes("head_mac", f.mac, 6);
            pWrite.end();
            return true;
          }
        }
      }
      delay(10);
    }
  }
#endif
  return false;
}

bool EspNowLink::addPeer(const uint8_t mac[6], uint8_t channel, bool encrypt) {
#ifndef KRISHI_NATIVE
  esp_now_peer_info_t peer{};
  memcpy(peer.peer_addr, mac, 6);
  peer.channel = channel;
  peer.encrypt = encrypt;
  if (esp_now_is_peer_exist(mac)) {
    return esp_now_mod_peer(&peer) == ESP_OK;
  }
  return esp_now_add_peer(&peer) == ESP_OK;
#else
  (void)mac; (void)channel; (void)encrypt;
  return true;
#endif
}

bool EspNowLink::send(const uint8_t mac[6], const uint8_t* frame, size_t len) {
#ifndef KRISHI_NATIVE
  return esp_now_send(mac, frame, len) == ESP_OK;
#else
  (void)mac; (void)frame; (void)len;
  return true;
#endif
}

bool EspNowLink::broadcast(const uint8_t* frame, size_t len) {
  return send(kBroadcastMac, frame, len);
}

}  // namespace krishi
