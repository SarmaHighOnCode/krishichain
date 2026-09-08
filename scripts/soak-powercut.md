# Hardware Power-Cut Soak Test Instructions

This document outlines the hardware validation script for 100 physical power-cut cycles using a smart relay / automated power controller.

## Automated Execution

1. Flash `node-head` environment to target board:
   ```bash
   cd firmware
   pio run -e node-head -t upload
   ```
2. Connect board USB to test harness with relay-controlled power supply.
3. Run automated power cycling loop:
   - Apply power for 1s to 5s (random duration).
   - Abruptly cut power during flash write cycle.
   - Restore power and query serial `STATUS` command.
   - Assert `count` matches committed chain records, and zero corruptions detected.
