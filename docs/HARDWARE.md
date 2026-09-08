# Hardware Guide

Owner: **H2** (build, power, enclosure, calibration) · **H1** (firmware, pin contracts)

> **Status: the BOM below is a specification, not an inventory.** Confirmed hardware is 2× ESP32
> and a PlatformIO toolchain. Every peripheral is listed with a substitute and a "what we lose"
> column so H2 can build with whatever is actually on the table. Ticket `H2-01` replaces the
> estimated prices with real ones.

---

## 1. Two nodes, two jobs

| | **FARM NODE** (`node-farm`) | **TRANSIT NODE** (`node-transit`) |
|---|---|---|
| Where | Crate at the farm gate, pre-cool shed | Sealed inside the cold box with the lot |
| Job | Commission the lot, capture harvest conditions | Prove the cold chain held, detect tampering |
| Interval | 30 s | 30 s (10 s during a demo breach) |
| Power | Mains / USB | Battery — this is the point |
| Connectivity | WiFi, usually online | **Usually offline**, store-and-forward |
| Must have | Temp + humidity | Temp + humidity + lid/light |
| Nice to have | Soil moisture, GPS | Shock (MPU6050), GPS |
| Demo role | "Here is where it started" | "Here is where it went wrong" |

The transit node carries the demo. If time is short, make the transit node perfect and let the
farm node be a simple sensor.

---

## 2. Bill of materials

### Tier 0 — required (the demo does not exist without these)

| Item | Qty/node | ₹ est. | Substitute | What we lose if substituted |
|---|---|---|---|---|
| ESP32 DevKit v1 (WROOM-32) | 1 | 300 | ESP32-C3 / ESP32-S3 | Nothing — pin map changes only |
| DHT22 (AM2302) temp + humidity | 1 | 150 | DHT11 | Accuracy ±2 °C vs ±0.5 °C — must disclose in the calibration record |
| | | | SHT31 (I²C) | **Better** — use it if available |
| | | | DS18B20 | Temperature only, no humidity |
| Breadboard / perfboard + jumpers | 1 | 60 | — | — |
| Micro-USB cable (data) | 1 | 50 | — | — |

### Tier 1 — strongly wanted (each unlocks a specific demo beat)

| Item | Qty/node | ₹ est. | Unlocks | Fallback if absent |
|---|---|---|---|---|
| LDR + 10 kΩ resistor | 1 | 20 | **Lid-open tamper detection** in a sealed box | Reed switch + magnet, or a push button taped to the lid |
| Reed switch + magnet | 1 | 30 | Tamper, robust in the dark | LDR |
| SSD1306 0.96" OLED (I²C) | 1 | 120 | On-device status + the commissioning QR | Serial monitor on a laptop, or LED blink codes |
| Status LED + 220 Ω (or onboard) | 1 | 5 | Judges read the LED from across a table | Onboard GPIO2 LED |
| TP4056 + 18650 cell + holder | 1 | 180 | Battery operation = credibility | USB power bank (perfectly acceptable, mention it) |

### Tier 2 — bonus (only if already owned; do not buy under time pressure)

| Item | ₹ est. | Unlocks | Risk |
|---|---|---|---|
| MPU6050 (I²C) | 100 | Shock/handling detection, `SHOCK` flag | Low — I²C, shares the OLED bus |
| MFRC522 RFID + tags | 150 | Physical crate-tag lot binding — a great demo beat | Medium — SPI wiring, 3.3 V only |
| NEO-6M GPS | 350 | Geo-tagged harvest + transit | Medium — needs sky view; indoor venues will not lock |
| SX1278 LoRa (RA-02) | 250 | Farm→gateway backhaul with no WiFi | **High** — antenna required, easy to burn, do not attempt inside 48 h unless already working |
| Soil moisture (capacitive) | 80 | Farm-node context | Low |
| DS3231 RTC | 120 | Trustworthy time while offline | Low — and it meaningfully strengthens the `tsq` story |

> **The LoRa judgement call:** it is the most impressive tier-2 item and the most likely to cost
> six hours. Only attempt it if a link is already proven working before the build starts. The
> offline store-and-forward demo already tells the "no connectivity" story without it.

### Cost summary

| Configuration | ₹ |
|---|---|
| Demo node (tier 0 + tier 1) | ~900 |
| Field node (tier 0 + LDR + battery, no OLED) | ~780 |
| Volume, 1k units, ESP32-C3-MINI + SHT31 | ~420 |

---

## 3. Pin map — the firmware/hardware contract

**H1 and H2 both edit this table, and it is the only place the pin map lives.** Firmware reads it
from `firmware/lib/krishi/pins.h`, which mirrors this exactly.

### Farm node

| Signal | GPIO | Notes |
|---|---|---|
| DHT22 data | 4 | 10 kΩ pull-up to 3.3 V |
| Soil moisture (ADC) | 34 | Input-only pin, ADC1 |
| Status LED | 2 | Onboard on most DevKit v1 |
| OLED SDA / SCL | 21 / 22 | I²C, shared |
| Button (lot bind) | 0 | Onboard BOOT button, active low |

### Transit node

| Signal | GPIO | Notes |
|---|---|---|
| DHT22 data | 4 | 10 kΩ pull-up |
| LDR (ADC) | 35 | Input-only, ADC1. **Do not use ADC2 — it is unusable while WiFi is on.** |
| Reed switch | 27 | `INPUT_PULLUP`, closed = lid shut |
| Status LED | 2 | |
| OLED SDA / SCL | 21 / 22 | |
| MPU6050 | 21 / 22 | Same I²C bus, addr `0x68` |
| Battery sense (ADC) | 33 | Via a 100 kΩ/100 kΩ divider — **required**, raw Li-ion exceeds 3.3 V |

### Pins to avoid on ESP32

| Pin(s) | Why |
|---|---|
| 6–11 | Wired to the SPI flash. Using them bricks the boot. |
| 0, 2, 12, 15 | Strapping pins — a pulled-up sensor here prevents booting |
| 34–39 | Input only, **no internal pull-ups** — external resistor required |
| ADC2 (0,2,4,12–15,25–27) | **Unavailable whenever WiFi is active.** This bites every ESP32 project once; it will not bite ours. |

---

## 4. Build sequence (H2)

1. **Bench test each sensor alone** on a spare board before integrating. A DHT22 that reads NaN
   is a 10-minute problem alone and a two-hour problem inside a finished node.
2. **Solder, do not breadboard**, for anything going into the cold box. Condensation plus DuPont
   jumpers on a demo table is a coin flip you do not need to take.
3. **Strain-relieve every wire** leaving the enclosure. The lid will be opened repeatedly during
   the demo; the tamper wire is the one that will break.
4. **Label both nodes physically** with their device address prefix (`0x7f3a…`) so a judge can
   match the box to the screen.
5. **Build the backup board third**, not last. At hour 40 you will not build it.

---

## 5. Calibration procedure (`H2-04`)

Feeds the on-chain calibration record (PROTOCOL §5), and is the honest answer to "how do you
know the sensor is right?"

1. Ice-water bath (0.0 °C) and room temperature, both measured with a reference thermometer.
2. Let the node settle 5 minutes at each point; record 10 readings.
3. Offset = mean(reference − measured), in deci-°C. Linear correction only; two points do not
   justify a curve.
4. Write the offset into NVS via the serial `CAL` command.
5. Node emits a record with `flags.CAL` set; the gateway stores it and its digest goes into
   `DeviceRegistry.metaHash`.
6. Log everything in `hardware/CALIBRATION.md` including the reference instrument used.

**Re-check drift at the start of demo day.** A node that sat in a car boot overnight is not the
node you calibrated.

---

## 6. Power (`H2-05`)

Measure and record in `hardware/POWER.md`:

| State | Expected mA @ 3.3 V | Measured |
|---|---|---|
| Boot + WiFi connect | ~160–250 | |
| Idle, WiFi connected | ~80–120 | |
| Sensor read + sign + store | ~120 peak | |
| Uplink burst | ~200 | |
| Deep sleep (P2) | < 0.05 | |

At ~100 mA average, a 2000 mAh 18650 gives ~20 h — comfortably past the 6 h requirement
(HW-04/NFR-08). Deep-sleep duty cycling is a P2 stretch that turns 20 h into weeks, and it is a
strong slide even if only measured rather than shipped.

**Signing cost is worth measuring separately.** "One secp256k1 signature costs X mJ, so
trustworthy sensing costs Y% more battery than untrustworthy sensing" is exactly the kind of
number a hardware-literate judge remembers.

---

## 7. Demo rig (`H2-07`)

| Prop | Purpose |
|---|---|
| Thermocol / small cooler box | The cold chain |
| 2–4 ice packs | Hold ~4 °C for the run |
| Crate + a few real tomatoes | Judges engage with food, not with a PCB |
| Printed QR labels on the crate | The consumer scan moment |
| Tamper seal sticker with `KC-SEAL-####` | Physical evidence, matched on-chain |
| Small USB fan or a hand warmer | **Force the breach on demand in ~90 s** |
| Phone on a stand | Shows the consumer page live |
| Spare pre-flashed board | Insurance |

**Tune the breach so it takes 60–120 seconds.** Too fast looks staged; too slow loses the room.
Time it during dry runs and know the number before you present.

---

## 8. Flashing

```bash
cd firmware/node-transit
pio run -t upload
pio device monitor -b 115200
```

First boot generates the keypair and prints the device address once. **Capture it** — it is
needed for `DeviceRegistry.registerDevice`:

```bash
npm run device:register -- --address 0x7f3a…c21b --class TRANSIT_V1 --seal KC-SEAL-0042
```

Erase and re-commission (new identity, use sparingly — it invalidates prior registration):

```bash
pio run -t erase
```
