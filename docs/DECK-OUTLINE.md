# Deck Outline — KrishiChain

Content outline for a human to build in Google Slides / PowerPoint / Keynote. Not a rendered
deck — one section below per slide. Sized for the 90-second and 5-minute cuts in
[DEMO-SCRIPT.md](DEMO-SCRIPT.md); this is not a 40-slide investor deck. Every claim here is
pulled from [PRD.md](PRD.md) or [ARCHITECTURE.md](ARCHITECTURE.md) — no new numbers, no new
claims. Section references point at where to double-check a number before presenting.

---

## Slide 1 — Title

**Claim:** KrishiChain — farm-to-fork traceability where the trust boundary lives inside the
sensor, not on our server.

- Event: IIC 2026, Problem statement 06 — AgriTech (PRD front matter)
- One line: "₹750 sensor nodes that sign and hash-chain their own readings, verified by anyone,
  trusted by no one — including us."
- Visual: photo of the physical transit node (or a render if not yet assembled).

## Slide 2 — The problem

**Claim:** Every traceability pilot in Indian agriculture fails at the same seam.

- **The paper gap** — handoffs recorded after the fact, on paper slips and WhatsApp photos; a
  claim, not evidence (PRD §2.1)
- **The cost gap** — enterprise platforms are priced for a Walmart supplier, not a 3-acre farmer
  with a ₹40,000 annual tech budget (PRD §2.2)
- **The trust gap** — a blockchain only proves a record hasn't changed *since it was written*;
  it proves nothing about the ten seconds before. Whoever fills in the row owns the "immutable"
  truth (PRD §2.3)
- Visual: three-icon strip (paper slip / price tag / question mark over a laptop) or a single
  line diagram of "sensor → laptop script → chain" with the laptop circled as the weak point.

## Slide 3 — The thesis

**Claim:** The only place the trust boundary can honestly sit is inside the device that observed
the physical world.

- Quote directly (PRD §2.3): *"Our thesis: the only place the trust boundary can honestly sit is
  inside the device that observed the physical world. Everything downstream should be
  verifiable, not trusted."*
- Each node holds a secp256k1 key generated on-chip that **never leaves the chip** (PRD §1, TL;DR)
- Every reading is signed and hash-chained to its predecessor — nothing silently dropped,
  reordered or back-dated, including hours spent offline (PRD §1)
- Visual: the trust-boundary diagram from ARCHITECTURE §3 — `Physical world → Sensor+MCU →
  Gateway → Chain → Consumer`, with the four labeled boundaries (unprovable / signed / anchored
  / publicly readable).

## Slide 4 — Architecture at a glance

**Claim:** Four surfaces over one verified event stream; nothing between the sensor and the
consumer is trusted by default.

- Field: ESP32 farm + transit nodes, keys in encrypted NVS (PRD §5.1, ARCHITECTURE §2.1)
- Gateway: the only thing that talks to both field and chain — verifies signature and
  hash-chain continuity *before* it stores anything (ARCHITECTURE §2.3, CLAUDE.md invariant #3)
- Chain: `DeviceRegistry`, `ActorRegistry`, `LotRegistry`, `BatchAnchor` — identity, lifecycle
  and 32-byte Merkle commitments only, never raw sensor data (PRD §9.1, ARCHITECTURE §2.4)
- Web: `/verify/:lotId` for the consumer, an ops surface for the FPO/transporter/QA roles
  (PRD §5, §7.4)
- Visual: the simplified system-shape flowchart from ARCHITECTURE §1 (Field → Gateway → Chain →
  Web), trimmed to the four boxes — skip the internal gateway pipeline detail for a live deck.

## Slide 5 — The verification moment

**Claim:** The consumer's browser re-derives the proof itself, without trusting our server.

- Scan a crate's QR → `/verify/<lotId>` renders the journey before verification even finishes —
  progressive enhancement, never a blocking spinner (PRD §6.6, ARCHITECTURE §2.5)
- **Verify independently** reads the Merkle root directly from a public RPC and recomputes the
  inclusion proof client-side (PRD §6.6 step 3, UI-02: works with the gateway process killed)
- Four honest badge states: `VERIFIED` · `PENDING ANCHOR` · `FLAGGED — COLD CHAIN BREACH` ·
  `UNVERIFIABLE — CHAIN GAP` (PRD §6.6, UI-03)
- Visual: screenshot of the `/verify/[lotId]` page mid-verification — the "Verify independently"
  button and the resulting badge/root-comparison panel.

## Slide 6 — What we prove, and what we don't

**Claim:** An explicit trust boundary is a product feature, not a confession — we state it before
a judge finds it (PRD §3).

- Reuse the **We Prove / We Do Not Prove** table from PRD §3 verbatim — both columns, all rows.
  It's the single highest-credibility slide in the deck; don't paraphrase it.
- Close on the pitch line (PRD §3, verbatim): *"We don't claim to make food honest. We make
  every claim about food attributable and non-repudiable, at a price a three-acre farmer can
  afford."*
- Visual: the actual PRD §3 table, reformatted as two slide-width columns (We Prove / We Do Not
  Prove), not a screenshot of the markdown.

## Slide 7 — Cost

**Claim:** Traceability overhead is under 0.2% of the goods' value — the number that makes this
viable for a 3-acre farmer, not just a Walmart supplier.

- Hardware: ≤ ₹750/node target (NFR-01); ≈ ₹780 estimated for the field config (no OLED), ≈ ₹420
  at volume with an ESP32-C3 (PRD §10.1)
- Blockchain: 74,775 gas measured per anchor; ≈ ₹0.00018 per traced record; ≈ ₹1.50 per traced
  crate (34 anchors over a 3-day journey) — versus ≈ ₹240/crate if every reading were written
  on-chain naively (PRD §10.2)
- Merkle batching (256 leaves or 60 s) is *why the product can exist*, not an optimization
  (PRD §10.2, closing line)
- Visual: a two-bar comparison chart, "₹240 naive" vs "₹1.50 Merkle-batched," plus the BOM table
  from PRD §10.1.

## Slide 8 — Close and ask

**Claim:** Verify it yourself — no KrishiChain account needed.

- Restate the P6 auditor job-to-be-done (PRD §4): *"Verify the claim without asking the vendor
  for permission"* — chain anchors + an open verify script. If asked whether the chain is
  public: it is local for this build, deliberately — take the `JUDGING.md` answer, do not
  imply otherwise from the stage
- What's next past the hackathon scope ladder (PRD §13, Should-tier): custody handoff with a
  wallet signature, EPCIS 2.0 projection, Polygon Amoy deployment, recall query, calibration
  records
- Production migration path: Hyperledger Fabric is named as the right enterprise answer once
  past hackathon constraints — deliberately not attempted here because it can't be stood up or
  demoed on a laptop with the WiFi pulled (PRD Appendix A)
- Visual: none required — a clean type-only closing slide with the pitch line from Slide 6
  repeated, plus contact/repo info.

---

## Notes for whoever builds this

- Slides 5 and 7 are the two most load-bearing — spend the design time there. Slide 6 is the
  most credibility-building; don't compress the table to save space.
- If the ops dashboard (`/ops`, PRD UI-05) is built by demo day, it's a reasonable optional
  visual to add to Slide 4 or 5 — it does not exist as a page yet as of this outline (only
  `/ops/labels`, the QR/label-sheet generator, does), so no slide above depends on it existing.
- Keep numbers exactly as sourced above; if a number changes in PRD.md before demo day (e.g. a
  re-measured gas cost), update this outline and the deck together, not just one of them.
