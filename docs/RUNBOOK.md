# Runbook

## Prerequisites

| Tool | Version | Needed by |
|---|---|---|
| Node.js | ≥ 22 (24 recommended) | Everyone |
| npm | ≥ 10 | Everyone |
| PlatformIO Core | latest | H1, H2 |
| Git | any | Everyone |

PlatformIO, if not already installed:

```bash
pip install -U platformio
```

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

```bash
cd firmware/node-transit
pio run                     # build
pio run -t upload           # flash
pio device monitor -b 115200
```

Host-side tests against the golden vectors (no board required):

```bash
cd firmware && pio test -e native
```

### Commissioning a node

1. Flash, then read the device address printed once on first boot.
2. Register it:

```bash
npm run device:register -- --address 0x… --class TRANSIT_V1 --seal KC-SEAL-0042
```

3. Point the node at the gateway (serial):

```
WIFI <ssid> <password>
GW http://192.168.1.50:8080
```

Find the laptop's LAN IP with `ipconfig` (Windows) or `ip addr` (Linux/macOS). The node needs the
**LAN** address, not `localhost`.

## Deploying to Polygon Amoy

1. Put a funded Amoy key in `.env` as `AMOY_PRIVATE_KEY`, and an RPC URL as `AMOY_RPC_URL`.
2. Fund it from a faucet (Alchemy or QuickNode — the official Polygon faucet is retired).
   **Do this at least 48 h before demo day** (risk R2).

```bash
npm run deploy:amoy
```

Addresses are written to `deployments/amoy/` and **are committed** — the web app reads them to
fetch anchor roots client-side.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Node gets `401` from the gateway | Device not in `DeviceRegistry`, or revoked | Run `device:register`; check you used the address, not the pubkey |
| Records rejected with `CHAIN_FORK` | Node was re-flashed but kept its address while chain state reset | `pio run -t erase` and re-commission, or reset the device's chain state in the gateway |
| Badge stuck on `PENDING ANCHOR` | Batch has not closed yet | Wait 60 s, or `npm run anchor:flush` |
| DHT22 returns NaN | Polled faster than 2 s, or a wiring/pull-up issue | Check the 10 kΩ pull-up; slow the interval |
| Analog sensor always reads 0 | Pin is on ADC2, which is dead while WiFi is on | Move to ADC1 (GPIO 32–39) |
| Node will not boot after wiring a sensor | Sensor pulling a strapping pin (0, 2, 12, 15) | Move the signal to a safe GPIO |
| `npm run dev` port conflict | 8545/8080/3000 in use | Stop the other process, or override the port in `.env` |
