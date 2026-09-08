---
description: Run the demo-day checklist against the current build
---

Verify the demo actually works right now. Run each check, report pass/fail with the evidence,
and do not mark anything green you did not actually observe.

**Software path (no hardware needed):**

1. `npm install` on a clean checkout completes, and `npm test` is green across all workspaces.
2. Start the gateway (`npm run dev:gateway`) and confirm `GET /health` responds.
3. `npm run sim -- --count 40 --breach --gap-at 12 --tamper-at 20` — confirm:
   - records are accepted and acknowledged (`ackSeq` advances),
   - the dropped record produces a `CHAIN_GAP` incident,
   - temperature climbs past the breach threshold.
4. `GET /ops/summary` shows batches > 0 and the incident count matches what the sim injected.
5. `GET /proof/<digest>` returns a root and a proof for an anchored record.
6. Open `/verify/<lotId>` and confirm the badge reflects the injected state.

**Trust properties (the things judges actually test):**

7. Alter a stored record's temperature, then re-verify — the badge must flip to `UNVERIFIABLE`
   or the proof must fail. If it still says verified, that is a **critical** finding.
8. Kill the gateway process, reload the consumer page, run verification again. Once `S2-03` is
   done this must still succeed against a public RPC. Until then, report honestly that the
   root is still coming from the gateway.
9. Confirm nothing in the demo path requires internet (NFR-09).

**Hardware path (if boards are attached):**

10. Both device addresses are registered on-chain.
11. Pull WiFi for 5 minutes, restore — the whole backlog uploads with zero gaps.
12. Open the lid — a `LID_OPEN` record appears within 2 s.

Finish with a short list of what is demo-ready, what is not, and the single highest-risk item.
