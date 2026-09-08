#pragma once
/**
 * Pin map — the firmware/hardware contract between H1 and H2.
 *
 * This file MIRRORS the table in docs/HARDWARE.md §3. If you change a pin here, change it
 * there in the same commit, or the person holding the soldering iron will wire the other one.
 *
 * ESP32 traps encoded below (docs/HARDWARE.md §3):
 *   - GPIO 6-11 are the SPI flash. Using them bricks the boot.
 *   - GPIO 0, 2, 12, 15 are strapping pins; a pulled-up sensor there stops the board booting.
 *   - GPIO 34-39 are input-only with NO internal pull-ups — external resistor required.
 *   - ADC2 pins (0,2,4,12-15,25-27) are UNUSABLE while WiFi is on. Every analog sensor here
 *     is therefore on ADC1 (32-39). This one bites every ESP32 project exactly once.
 */

namespace krishi {
namespace pins {

#if defined(KRISHI_NODE_FARM)

constexpr int kDhtData = 4;        // DHT22 data, 10k pull-up to 3V3
constexpr int kSoilMoisture = 34;  // ADC1, input-only
constexpr int kStatusLed = 2;      // onboard LED on most DevKit v1 boards
constexpr int kOledSda = 21;
constexpr int kOledScl = 22;
constexpr int kLotButton = 0;      // onboard BOOT button, active low

constexpr bool kHasLdr = false;
constexpr bool kHasReed = false;
constexpr bool kHasBatterySense = false;

#elif defined(KRISHI_NODE_LEAF)

/**
 * LEAF node on the Wemos Lolin S2 Mini (ESP32-S2FN4R2, single-core, no BT).
 * Safe first-pick GPIOs per the S2 Mini pinout: 1,2,3,4,5,6,7,8,17,18,21,38.
 * GPIO15 is the onboard blue LED; GPIO0 is the BOOT button.
 */
constexpr int kDhtData = 4;        // DHT22 data, 10k pull-up to 3V3
constexpr int kLdr = 5;            // light divider, ADC-capable, safe GPIO
constexpr int kBatterySense = 6;   // ADC via a 100k/100k divider — REQUIRED, Li-ion > 3.3V
constexpr int kStatusLed = 15;     // onboard blue LED
constexpr int kLotButton = 0;      // BOOT button, active low

constexpr bool kHasLdr = true;
constexpr bool kHasReed = false;
constexpr bool kHasBatterySense = true;

#elif defined(KRISHI_NODE_CAM)

/**
 * WITNESS node on the AI Thinker ESP32-CAM. The camera + SD own nearly every
 * pin, so there is no DHT/LDR here: `lux` is the frame mean-luma proxy and
 * T/H always carry the fault sentinel. GPIO33 is the onboard red lamp
 * (active low) — the lid-open beacon. GPIO4 is the white flash LED.
 */
constexpr int kRedLed = 33;        // onboard red lamp, active low
constexpr int kFlashLed = 4;       // white flash LED, keep OFF (blinds the verdict)
constexpr int kStatusLed = 33;

constexpr bool kHasLdr = false;
constexpr bool kHasReed = false;
constexpr bool kHasBatterySense = false;

#elif defined(KRISHI_NODE_TRANSIT)

constexpr int kDhtData = 4;
constexpr int kLdr = 35;           // ADC1, input-only. NOT ADC2 — WiFi kills ADC2.
constexpr int kReedSwitch = 27;    // INPUT_PULLUP; closed = lid shut
constexpr int kStatusLed = 2;
constexpr int kOledSda = 21;
constexpr int kOledScl = 22;
constexpr int kBatterySense = 33;  // ADC1 via a 100k/100k divider — REQUIRED, Li-ion > 3.3V
constexpr int kLotButton = 0;

constexpr bool kHasLdr = true;
constexpr bool kHasReed = true;
constexpr bool kHasBatterySense = true;

#endif

}  // namespace pins
}  // namespace krishi
