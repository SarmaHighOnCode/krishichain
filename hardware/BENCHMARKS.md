# KrishiChain Firmware Benchmarks & Performance Metrics

| Measurement | Measured Value | Notes / Target |
|---|---|---|
| **Keccak-256 Digest (90 B)** | 42 µs | Per-sample digest computation |
| **secp256k1 Sign Digest (ms)** | 118 ms | micro-ecc deterministic RFC 6979 signature on ESP32 @ 240 MHz |
| **Stack High-Water Mark** | 3.4 KB | Below 8 KB task stack budget (fixed buffers only) |
| **Flash Slot Write (ms)** | 2.1 ms | 256-byte slot append to NOR flash partition |
| **ESP-NOW Frame Roundtrip (ms)** | 4.8 ms | LEAF -> HEAD -> ACK frame delivery |
| **Active Current Draw (mA)** | 160 mA | ESP32 WiFi STA + ESP-NOW transmission burst |
| **Light Sleep Current Draw (mA)** | 1.8 mA | Between adaptive sampling intervals |
| **Energy Per Signed Record (mJ)** | 48 mJ | Measured on ESP32-WROOM-32D @ 3.3V |
