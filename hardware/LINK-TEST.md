# ESP-NOW Link Test Procedures & Criteria

This document details the hardware validation procedure for the KrishiChain ESP-NOW link layer (Task 8 / ADR-0005).

## Test Matrix

| Test ID | Procedure | Pass Criterion |
|---|---|---|
| **LINK-01** | Power HEAD node, then LEAF node within 10 m. | LEAF locks channel & records HEAD MAC within 5 s. |
| **LINK-02** | Trigger sensor reading on LEAF. | RECORD frame arrives at HEAD `pop()` byte-identical; HEAD emits ACK frame; LEAF releases slot. |
| **LINK-03** | Power off HEAD node. LEAF continues operating. | LEAF continues sampling & buffering to flash; re-acquires link within 15 s after HEAD repower. |
| **LINK-04** | Expose nodes to 2.4 GHz co-channel traffic. | `droppedForeign()` counter increments on foreign frames; non-Krishi frames rejected without parsing error. |
| **LINK-05** | Increase distance between LEAF and HEAD in open field. | Record packet delivery ratio (PDR) vs distance; establish operational range limit (>= 150 m line of sight). |
