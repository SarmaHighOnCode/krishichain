# Demo Script — 5 minutes

Owner: **H2** calls the physical props · **S2** drives the screen · **H1** and **S1** answer
technical questions. Rehearse it twice, timed, before demo day (`H2-10`, `GATE-2`).

**Setup before you are called:** local chain running, gateway up, both nodes powered and
registered, cold box at ~4 °C, phone on the stand showing `/verify/…`, laptop mirrored to the
projector, breach tool (USB fan / hand warmer) within reach, backup board in your pocket.

---

## 0:00–0:30 · The hook

> "Every food traceability project puts sensor data on a blockchain and calls it trusted. But a
> blockchain only proves the data hasn't changed *since it was written*. If a laptop script
> writes the row, whoever owns that laptop owns the truth. You get immutable garbage.
>
> So we moved the cryptography into a ₹750 sensor node. This box signs its own readings with a
> key that has never left the chip."

*Hold up the transit node. Physical object in hand, not a slide.*

## 0:30–1:15 · Harvest → the QR

- Tap the crate tag on the farm node → lot opens on-chain.
- Scan the crate QR with a judge's own phone → the journey page loads.

> "That's the consumer view. Farm, harvest time, cold chain, custody. Nothing surprising yet."

## 1:15–2:15 · The verification moment ★

*This is the beat the whole project exists for. Do not rush it.*

- Tap **Verify independently**.
- Narrate as it runs: "The page just fetched the Merkle root straight from our chain node —
  a **separate process** from the one that served the record, running on this laptop but
  outside our control the moment it started. It's recomputing the hash of this reading and
  walking the proof up the tree in your browser. Green."
- **Then kill the gateway process on the laptop.** Reload the page. Tap verify again. Still
  green — the chain node is still up, and the browser was never talking to the gateway for
  this part anyway.

> "Our backend is dead and verification still works. That's the point — you never had to trust us."

## 2:15–3:00 · The breach

- Open the cold box lid. LED goes amber; `LID_OPEN` flag fires.
- Apply the heat source. Watch the ops dashboard temperature climb.
- At threshold, the lot flips to **FLAGGED — COLD CHAIN BREACH** on-chain, and the consumer page
  updates.

> "The transporter can't hide this, and the buyer can't invent it. It's signed by the device and
> anchored on-chain."

## 3:00–3:45 · The offline test ★

*The beat that separates this from every other traceability demo.*

- Pull the WiFi. Point at the LED: now blue, **BUFFERING**.
- Keep talking for 30 seconds. Let it accumulate records.

> "A rural cold chain is offline most of the time. This node is still recording — into flash,
> each record hash-chained to the one before it. It cannot rewrite what it already wrote, even
> offline. It can't even quietly drop one."

- Restore WiFi. The backlog drains. Dashboard shows records arriving with the `BUFFERED` flag.

> "Gapless. Every record verified, including the ones taken while it was disconnected."

## 3:45–4:15 · The honest slide

- Open the DB and hand-edit one temperature value. Reload the consumer page.
- Badge flips to **UNVERIFIABLE**.

> "We edited our own database. The system caught us. And to be straight with you about what this
> does *not* prove: we cannot prove the sensor was physically with the tomatoes. No cryptography
> can. What we prove is that every claim is attributable to a specific commissioned device and a
> named party — and that nobody can silently change it later."

*Judges consistently reward the team that names its own limits before they do.*

## 4:15–5:00 · Cost and close

- One slide: **₹750 per node. ₹1.50 of blockchain cost per crate journey. Under 0.2% of goods value.**

> "Writing every reading on-chain would cost about ₹240 a crate — that's why those pilots die. We
> Merkle-batch 256 readings into one transaction. Same guarantee, a thousandth of the cost.
>
> Two ESP32s, four contracts, and a trust boundary in the right place."

---

## Fallbacks

| If this breaks | Do this |
|---|---|
| A node dies | Swap the pre-flashed backup board (`H2-09`). Keep talking; it takes 30 s. |
| Venue WiFi fails | Phone hotspot — though the demo never needs internet at all (NFR-09). |
| The breach is too slow | Cut to the offline test, come back to the breach at the end. |
| Everything fails | Play the recorded run. Then hand a judge the node and walk the architecture. |

**Never** say "it worked earlier". Show the fallback, keep moving, stay calm — poise under a
broken demo scores better than a flawless run.

---

## The 90-second version

For a judging-floor slot, not the main stage. Budget: hook (15 s) → verification moment
(35–40 s) → honest failure (20 s) → cost and close (15–20 s). Runs entirely on
`npm run dev` + `npm run sim`; a physical node in hand helps but isn't required for this cut.

**Pre-demo checklist for this cut:** run `npm run deploy:local` *before* you
start talking, so `deployments/localhost/addresses.json` exists. If it doesn't, the **Verify
independently** button never appears — the verify page renders an honest **Not deployed** card
instead, and the script below adapts at the ★ beat rather than faking a green badge.

### 0:00–0:15 · The hook

> "Every food traceability pilot puts sensor data on a blockchain and calls it trusted. But a
> blockchain only proves a record hasn't changed *since it was written* — it says nothing about
> the ten seconds before that. Whoever fills in the row still owns the truth.
>
> KrishiChain puts the signing key inside the ₹750 sensor node itself. It signs its own reading
> before anything touches a server."

- Hold up the transit node, or point at the laptop if it isn't on the table.

### 0:15–0:55 · The verification moment ★

*This is the beat the whole project exists for.*

- Scan the crate QR (or open the URL directly) → `/verify/<lotId>` loads.
- **If contracts are deployed:** tap **Verify independently**.

  > "This isn't reading our database. The browser just pulled the Merkle root straight from the
  > chain and recomputed the proof itself, right here."

  Kill the gateway process on the laptop. Reload the page. Tap verify again — same result.

  > "Our backend just died and that didn't change. You never had to trust our server. Only the
  > math."

- **If contracts aren't deployed yet:** the page shows **Not deployed** instead of a button.

  > "This card is honest, not broken — there's a real Merkle proof sitting behind it, but nothing
  > on-chain to check it against yet, so the page refuses to call it verified. That refusal is
  > the same design principle as the green checkmark you'd otherwise see."

### 0:55–1:15 · The honest failure

> "And when something really is wrong, we don't hide it either."

- In a terminal: `npm run sim -- --gap-at 40` — the simulator signs and hash-chains every record
  normally, then silently drops record 40 before it's sent.
- Reload `/verify/<lotId>`. The badge reads **Unverifiable — chain gap or fork**.

> "We just told our own simulated node to drop a reading mid-stream. The gateway noticed the
> missing sequence number and refused to call the lot verified. Nobody has to take our word that
> we'd catch a real gap — you just watched us catch a fake one."

### 1:15–1:30 · Cost and close

> "Two ESP32s, signing on-device, hash-chained so nothing can be dropped even offline. We
> Merkle-batch readings so a crate costs about ₹1.50 to trace instead of ₹240 written naively —
> under 0.2% of the goods' value. ₹750 a node, and the buyer never has to trust us. Only the
> chain."

---

## The 30-second version

If you get cut short, this is the whole pitch:

> "Sensor nodes that sign their own data with a key that never leaves the chip, hash-chained so
> nothing can be dropped even offline, Merkle-batched so a crate costs ₹1.50 to trace instead of
> ₹240, and verifiable in the consumer's own browser without trusting our servers. ₹750 a node."
