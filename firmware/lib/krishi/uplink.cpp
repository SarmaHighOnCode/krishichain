#include "uplink.h"
#include "roles.h"

#include <stdio.h>
#include <string.h>

#ifndef KRISHI_NATIVE
#include <HTTPClient.h>
#include <WiFi.h>
#endif

namespace krishi {

size_t groupByDevice(const Record* records, size_t count,
                     size_t* runStarts, size_t* runLengths, size_t maxRuns) {
  if (records == nullptr || count == 0 || maxRuns == 0) return 0;

  size_t runCount = 0;
  runStarts[0] = 0;
  runLengths[0] = 1;
  runCount = 1;

  for (size_t i = 1; i < count; ++i) {
    if (memcmp(records[i].dev, records[i - 1].dev, kAddressLength) == 0) {
      runLengths[runCount - 1]++;
    } else {
      if (runCount >= maxRuns) break;
      runStarts[runCount] = i;
      runLengths[runCount] = 1;
      runCount++;
    }
  }

  return runCount;
}

bool Uplink::begin(const char* gatewayUrl) {
  gatewayUrl_ = gatewayUrl;
  backoffMs_ = 2000;
  return gatewayUrl_ != nullptr;
}

bool Uplink::isOnline() const {
#ifndef KRISHI_NATIVE
  return WiFi.status() == WL_CONNECTED;
#else
  return true;
#endif
}

UplinkResponse Uplink::sendBatch(const uint8_t* canonicalBlock, const uint8_t* signatureBlock,
                                 size_t count, const uint8_t dev[kAddressLength]) {
  UplinkResponse resp{};
  if (count == 0 || gatewayUrl_ == nullptr) return resp;

#ifndef KRISHI_NATIVE
  if (!isOnline()) {
    resp.result = UplinkResult::kNoNetwork;
    return resp;
  }

  // Build JSON body manually into static buffer:
  // {"dev":"0x...","records":[{"canonical":"0x...","signature":"0x..."},...]}
  static char jsonBuf[kMaxUplinkBatch * 320 + 128];
  char devHex[kAddressLength * 2 + 3];
  toHex(dev, kAddressLength, devHex, sizeof(devHex));

  int pos = snprintf(jsonBuf, sizeof(jsonBuf), "{\"dev\":\"%s\",\"records\":[", devHex);

  for (size_t i = 0; i < count; ++i) {
    char canHex[kCanonicalLength * 2 + 3];
    char sigHex[kSignatureLength * 2 + 3];
    toHex(canonicalBlock + i * kCanonicalLength, kCanonicalLength, canHex, sizeof(canHex));
    toHex(signatureBlock + i * kSignatureLength, kSignatureLength, sigHex, sizeof(sigHex));

    pos += snprintf(jsonBuf + pos, sizeof(jsonBuf) - pos,
                    "%s{\"canonical\":\"%s\",\"signature\":\"%s\"}",
                    i == 0 ? "" : ",", canHex, sigHex);
    if (pos >= static_cast<int>(sizeof(jsonBuf)) - 10) break;
  }
  snprintf(jsonBuf + pos, sizeof(jsonBuf) - pos, "]}");

  HTTPClient http;
  http.begin(gatewayUrl_);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(10000);

  int httpCode = http.POST(reinterpret_cast<uint8_t*>(jsonBuf), strlen(jsonBuf));
  if (httpCode > 0) {
    if (httpCode == 200) {
      resp.result = UplinkResult::kOk;
      backoffMs_ = 2000;
      String payload = http.getString();
      // parse ackSeq, serverTs, accepted simple JSON fields if present
      sscanf(payload.c_str(), "{\"ackSeq\":%u,\"serverTs\":%llu", &resp.ackSeq, &resp.serverTs);
    } else if (httpCode == 400) {
      resp.result = UplinkResult::kMalformed;
    } else if (httpCode == 401) {
      resp.result = UplinkResult::kUnauthorised;
    } else if (httpCode == 429) {
      resp.result = UplinkResult::kBackoff;
      backoffMs_ = backoffMs_ * 2 > 60000 ? 60000 : backoffMs_ * 2;
    } else {
      resp.result = UplinkResult::kServerError;
      backoffMs_ = backoffMs_ * 2 > 60000 ? 60000 : backoffMs_ * 2;
    }
  } else {
    resp.result = UplinkResult::kServerError;
    backoffMs_ = backoffMs_ * 2 > 60000 ? 60000 : backoffMs_ * 2;
  }
  http.end();
#else
  // Native test mock fallback
  (void)canonicalBlock; (void)signatureBlock; (void)dev;
  resp.result = UplinkResult::kOk;
  resp.ackSeq = count - 1;
  resp.accepted = count;
#endif

  return resp;
}

UplinkResponse Uplink::send(const Record* records, const uint8_t* signatures, size_t count,
                            const uint8_t deviceAddress[kAddressLength]) {
  if (count == 0) return UplinkResponse{};
  uint8_t canonicalBlock[kMaxUplinkBatch * kCanonicalLength];
  for (size_t i = 0; i < count && i < kMaxUplinkBatch; ++i) {
    encodeRecord(records[i], canonicalBlock + i * kCanonicalLength, kCanonicalLength);
  }
  return sendBatch(canonicalBlock, signatures, count, deviceAddress);
}

}  // namespace krishi
