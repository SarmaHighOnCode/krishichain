# Runbook

## Prerequisites

| Tool | Version | Needed by |
|---|---|---|
| Node.js | ≥ 22 (24 recommended) | Everyone |
| npm | ≥ 10 | Everyone |
| Python | ≥ 3.9 | H1, H2 (for PlatformIO) |
| PlatformIO Core | latest | H1, H2 |
| Git | any | Everyone |

### Quick PlatformIO Setup

PlatformIO requires Python and handles ESP32 toolchain installation automatically.

**Windows:** Run `setup-pio.bat` from the repo root.  
**macOS/Linux:** Run `bash setup-pio.sh` from the repo root.

Or install manually:

```bash
pip install -U platformio
```

For detailed setup including driver installation and board detection, see [PLATFORMIO-SETUP.md](PLATFORMIO-SETUP.md).

## First run

```bash
git clone https://github.com/SarmaHighOnCode/krishichain.git
cd krishichain
npm install
cp .env.example .env
npm run dev
```

`npm run dev` starts three processes:

| Service | Port | What |
|---|---|---|
| Local chain (Hardhat node) | 8545 | Deterministic, offline-capable |
| Gateway | 8080 | Ingest, verify, batch, anchor |
| Web | 3000 | Consumer verify + ops dashboard |

Contracts are deployed to the local chain automatically on first `dev` start; addresses land in
`deployments/localhost/`.

## Demo data without hardware

```bash
npm run seed                          # one complete lot journey, verified and anchored
npm run sim                           # a simulated node streaming live records
npm run sim -- --breach --gap-at 40   # inject a cold-chain breach and a chain gap
```

Open http://localhost:3000/ops for the dashboard, and the `/verify/<lotId>` link it prints for
the consumer view.

## Firmware

See [PLATFORMIO-SETUP.md](PLATFORMIO-SETUP.md) for comprehensive setup including:
- Board driver installation
- Device detection and troubleshooting
- IDE integration (VS Code, CLion, etc.)
- Build and upload workflow

Quick reference:

```bash
cd firmware

# Build for HEAD node (WiFi uplink)
pio run -e node-head

# Build + upload to device
pio run -e node-head -t upload

# Watch device serial output
pio device monitor -b 115200

# Build all targets (HEAD, LEAF, CAM)
pio run

# List available environments
pio run --list-targets
```

Host-side tests against the golden vectors (no board required):

```bash
cd firmware && pio test -e native
```

### Commissioning a node

1. Ensure your board is detected: `pio device list` (see [PLATFORMIO-SETUP.md](PLATFORMIO-SETUP.md) for troubleshooting)
2. Flash the correct firmware for your board type:
   - **FARM node (ESP32 dev board):** `pio run -e node-head -t upload`
   - **TRANSIT node (ESP32-S2 Lolin Mini):** `pio run -e node-leaf -t upload`
   - **WITNESS node (ESP32-CAM):** `pio run -e node-cam -t upload`
3. Read the device address printed once on first boot: `pio device monitor -b 115200`
4. Register it:

```bash
npm run device:register -- --address 0x… --class TRANSIT_V1 --seal KC-SEAL-0042
```

5. Point the node at the gateway (send via serial terminal):

```
WIFI <ssid> <password>
GW http://192.168.1.50:8080
```

Find the laptop's LAN IP with `ipconfig` (Windows) or `ip addr` (Linux/macOS). The node needs the
**LAN** address, not `localhost`.

## Troubleshooting

### General issues

| Symptom | Cause | Fix |
|---|---|---|
| Node gets `401` from the gateway | Device not in `DeviceRegistry`, or revoked | Run `device:register`; check you used the address, not the pubkey |
| Records rejected with `CHAIN_FORK` | Node was re-flashed but kept its address while chain state reset | `pio run -t erase` and re-commission, or reset the device's chain state in the gateway |
| Badge stuck on `PENDING ANCHOR` | Batch has not closed yet | Wait 60 s, or `npm run anchor:flush` |
| DHT22 returns NaN | Polled faster than 2 s, or a wiring/pull-up issue | Check the 10 kΩ pull-up; slow the interval |
| Analog sensor always reads 0 | Pin is on ADC2, which is dead while WiFi is on | Move to ADC1 (GPIO 32–39) |
| Node will not boot after wiring a sensor | Sensor pulling a strapping pin (0, 2, 12, 15) | Move the signal to a safe GPIO |
| `npm run dev` port conflict | 8545/8080/3000 in use | Stop the other process, or override the port in `.env` |

### PlatformIO & firmware issues

| Symptom | Cause | Fix |
|---|---|---|
| `pio: command not found` | PlatformIO not installed | Run `setup-pio.bat` (Windows) or `bash setup-pio.sh` (macOS/Linux) |
| `No boards detected` | Drivers not installed, or board not plugged in | See [PLATFORMIO-SETUP.md § Device Connection](PLATFORMIO-SETUP.md#step-3-verify-your-board-connection) |
| Upload fails: `espcomm_open` or `Failed to connect` | Serial port in use, or wrong board selected | Check `pio device list`; close serial monitor; try `pio run -e node-head -t erase` |
| Serial monitor shows garbled text | Baud rate mismatch | Must be 115200 (already set in `platformio.ini`); check `pio device monitor` is not set differently |
| Build fails: `undefined reference to micro-ecc` | Corrupted `.pio` cache | Delete `.pio/libdeps` and `.pio/build`, then rebuild |
| Import errors in IDE (VS Code) | C/C++ include paths not configured | VS Code PlatformIO extension should auto-configure; check `.vscode/c_cpp_properties.json` exists |
| Board not recognized in PlatformIO | Windows MAX_PATH issue (long file names) | Ensure Windows long-path support is enabled; see [PLATFORMIO-SETUP.md](PLATFORMIO-SETUP.md) |
