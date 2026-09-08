# ESP32-CAM Programming + Test Guide (AI Thinker, H2-12)

Owner: H2. Board: AI Thinker ESP32-CAM. No wiring needed — camera + SD are
on-board modules, USB is the only cable. Live sensor truth in the demo comes
from the phone PWA; the CAM contributes photo-hash + lid verdict.

Repo state: branch `h2/H2-11-leaf-bring-up`. All commands run from `firmware/`.
Toolchain: `C:\Users\Lenovo\.platformio\penv\Scripts\pio.exe` (your VS Code
PlatformIO install — same `pio` your Meantendo project uses).

---

## 0. What you need on the table

- AI Thinker ESP32-CAM + microSD card (FAT32, any size — each capture is 75 KB)
- USB-to-serial adapter (FTDI/CP2102, 3.3V) **or** an ESP32-CAM-MB programmer
  board. The AI Thinker has no USB port — this adapter IS the programming step.
- 4–5 jumper wires (only for flashing, not sensors). Nothing stays wired.

## 1. Wire ONLY to flash (remove after)

| Adapter | CAM pin |
|---|---|
| 3V3 | 3V3 (NOT 5V — the camera is 3.3V) |
| GND | GND |
| TX | U0R (GPIO3) |
| RX | U0T (GPIO1) |
| GND | GPIO0 (only while flashing — this is "download mode") |

With the ESP32-CAM-MB: just seat the CAM on the MB, set its switch to the
program position, plug USB. No jumpers at all.

## 2. Flash the bring-up firmware first (proves board + cable + SD + WiFi)

This firmware has ZERO krishi dependencies — plain Arduino + camera + SD +
a web page. If this fails, the problem is the toolchain/board, not our
protocol code. Do not flash `node-cam` until you see your own camera feed.

```bat
cd D:\hackathon\iic3\krishichain\firmware
C:\Users\Lenovo\.platformio\penv\Scripts\pio.exe run -e cam-bringup -t upload
C:\Users\Lenovo\.platformio\penv\Scripts\pio.exe device monitor -b 115200
```

Power cycle with GPIO0 UNGROUNDED (run mode), then expect:

```
cam-bringup ok
camera: OV2640 JPEG SVGA, PSRAM frame buffer
sd: 1234 MB free
wifi: 192.168.x.x — open it for the LIVE feed
cap #0 mean=87 bytes=12345 sd=ok
```

Checks:

- [ ] Open `http://192.168.x.x/` on your laptop/phone — you see the LIVE
  camera feed refreshing every 5 s, plus a Capture link. This is how you SEE
  what the camera sees; no file viewer needed
- [ ] `/bringup/c0.jpg` on the SD opens in any photo viewer (JPEG SVGA —
  the old `.raw` pixel dumps are gone)
- [ ] Cover the lens → feed goes dark, `mean` drops, red lamp turns off.
  Uncover → bright again, lamp on. That swing IS the lid verdict signal
  (threshold 40): dark sealed box = `lid=shut`, bright room = `lid=OPEN`
- [ ] `sd: MOUNT FAILED` → reseat the card, confirm FAT32, retry (captures
      still print — the card is backup, not blocking, at this stage)

Troubleshooting:

| Symptom | Fix |
|---|---|
| `Timed out waiting for packet header` | GPIO0 not grounded at reset, or TX/RX swapped |
| `camera init failed` | Wrong env (`esp32cam`), or 5V used instead of 3.3V |
| Brownouts / reboot loop | USB port too weak — powered hub or shorter cable |
| COM port missing | Adapter driver (CP210x/FTDI); MB board needs its CH340 driver |
| `wifi: FAILED` | Wrong SSID/pass in `cam-bringup/src/main.cpp` (`kWifiSsid`) — SD still works |
| Live page loads but no image | Point the lens at light; check `cap #N` lines are printing |

## 3. Flash the real witness firmware

Same cable, same procedure, different env. Full krishi stack: canonical
record + chain + signature + SD archive (`/krishi/c<seq>.raw` + `.meta`).
Currently prints the signed output to serial; the `/ingest` POST lands with
H1-07, so serial is the verified output today.

```bat
cd D:\hackathon\iic3\krishichain\firmware
C:\Users\Lenovo\.platformio\penv\Scripts\pio.exe run -e node-cam -t upload
C:\Users\Lenovo\.platformio\penv\Scripts\pio.exe device monitor -b 115200
```

Expect every 60 s:

```
KrishiChain WITNESS node (ESP32-CAM)
device address: 0x...            <- COPY THIS for device:register
camera: grayscale QVGA, PSRAM frame buffer
sd: ... MB total, ... MB free
cam seq=0 mean=87 lid=OPEN photo=0x... digest=0x...
```

Demo beats on this firmware: cover the lens → `lid=shut`, red lamp off.
Uncover under room light → `lid=OPEN`, red lamp on. Pull the card mid-run →
hashes keep printing (chain intact), archive warns only.

## 4. Sanity commands (no board needed)

```bat
cd D:\hackathon\iic3\krishichain\firmware
C:\Users\Lenovo\.platformio\penv\Scripts\pio.exe test -e native   :: 12/12 green = protocol intact
```

`node-cam` compiles to link today and waits on H1's `identity/chain/buffer/
uplink` `.cpp` implementations — `node-transit` fails identically on main,
so that gap is H1's ticket, not this board. `cam-bringup` links TODAY and
is the proof your hardware path works end to end.
