/**
 * Landing page.
 *
 * Replaces the S2-01 scaffold. Dark, brutalist and mono-heavy on purpose: the brief is to make
 * the page read like an audit instrument rather than a SaaS marketing site, and to expose the
 * cryptography instead of hiding it behind a checkmark.
 *
 * Every number on this page is taken from the code, not from the pitch:
 *   - 90-byte canonical record          PROTOCOL.md §1.3 / packages/core/src/record.ts
 *   - batch closes at 256 leaves / 60 s apps/gateway/src/batcher.ts
 *   - anchor() 74,775 gas               contracts/test — asserted under an 80,000 ceiling
 *   - 10.0 °C breach threshold          apps/web/lib/incidents.ts DEFAULT_TEMP_MAX_C
 *   - the four badge states             components/Badge.tsx
 * If one of those changes, change it here too — a landing page that overstates the system is
 * the same failure mode as a badge that overstates a record.
 */

import styles from "./page.module.css";

/** `npm run sim` publishes to this lot (scripts/sim-node.ts default). */
const SIM_LOT = "0x018f2c9a7b3d4e5f8091a2b3c4d5e6f7";
/** `npm run seed` rolls three smallholdings into this truck lot (scripts/seed.ts). */
const SEED_LOT = "0x018f2c0000000000000000000000b027";
const REPO_URL = "https://github.com/SarmaHighOnCode/krishichain";

const PIPELINE = [
  {
    num: "STEP 01",
    name: "Sign",
    body: (
      <>
        The ESP32 packs a reading into a fixed{" "}
        <span className={styles.mono}>90-byte</span> canonical record, hashes it with keccak256
        and signs it with secp256k1 — on the device, before anything leaves it. Each record
        carries the digest of the one before it, so the node keeps its own hash chain.
      </>
    ),
  },
  {
    num: "STEP 02",
    name: "Verify",
    body: (
      <>
        The gateway checks the signature and the chain link{" "}
        <span className={styles.mono}>before</span> it stores anything. A bad signature or a
        broken chain goes to quarantine, never to the main store. Gaps, forks and replays are
        each their own verdict, not one generic error.
      </>
    ),
  },
  {
    num: "STEP 03",
    name: "Prove",
    body: (
      <>
        Verified digests are batched into a Merkle tree and the root is anchored on-chain. Your
        browser then re-encodes the record it is showing you, recomputes the leaf, and walks the
        proof against the root it read from the chain itself.
      </>
    ),
  },
];

const STATES = [
  {
    name: "Verified",
    color: "var(--green)",
    body: "Signatures valid, the device's hash chain is continuous, and every record in the lot sits under a root already confirmed on-chain.",
  },
  {
    name: "Pending anchor",
    color: "var(--amber)",
    body: "Everything checks out locally, but the batch has not been committed to the chain yet. Honest waiting — not a soft pass.",
  },
  {
    name: "Flagged",
    color: "var(--red)",
    body: "A cold-chain breach corroborated across signals — temperature plus a lid-open or shock witness in the same lot and window, not one twitchy sensor.",
  },
  {
    name: "Unverifiable",
    color: "var(--faint)",
    body: "Records are missing or the device's history forked. The system says so plainly instead of rendering a failure as a pass. This state is designed, not an error screen.",
  },
];

const SPEC = [
  { k: "Canonical record", v: "90 bytes, fixed layout, big-endian", note: "PROTOCOL.md §1.3" },
  { k: "Signature", v: "secp256k1, RFC 6979 deterministic, low-s normalised", note: "" },
  { k: "Digest", v: "keccak256 over the canonical bytes", note: "" },
  { k: "Chain integrity", v: "per-device seq + prev digest", note: "verdicts: accept / gap / fork / duplicate" },
  { k: "Batching", v: "closes at 256 leaves or 60 seconds", note: "sorted-pair keccak, OpenZeppelin-compatible" },
  { k: "Anchor cost", v: "74,775 gas", note: "asserted under an 80,000 ceiling" },
  { k: "Breach rule", v: "2-of-3 corroboration above 10.0 °C", note: "cross-device, cross-signal, same window" },
  { k: "On-chain data", v: "identity, lifecycle and 32-byte commitments only", note: "no raw sensor data, ever" },
];

export default function Home() {
  return (
    <main className={styles.page}>
      {/* ---------- 01 hero ---------- */}
      <section className={styles.section}>
        <div className={styles.shell}>
          <span className={styles.num}>01</span>

          <div className={styles.heroGrid}>
            <div className={styles.heroCopy}>
              <h1 className={styles.wordmark}>KRISHICHAIN</h1>
              <p className={styles.tagline}>sealed at the sensor, not at the server</p>

              <p className={styles.claim}>
                <span className={styles.claimAccent}>
                  A cold-chain certificate is not a paperwork problem. It is a trust problem.
                </span>{" "}
                KrishiChain signs the reading, not the report.
              </p>

              <p className={styles.meta}>
                Farm-to-fork traceability · IIC 2026 · AgriTech
              </p>

              <div className={styles.actions}>
                <a className={styles.cta} href={`/verify/${SEED_LOT}`}>
                  <span className={styles.ctaLabel}>Open a verified lot</span>
                  <span className={styles.ctaSub}>
                    local chain · no wallet · works offline
                  </span>
                </a>
                <a
                  className={styles.link}
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  View source
                </a>
              </div>
            </div>

            {/* The reference's light contrast block, carrying the protocol's real field names. */}
            <aside className={styles.specimen}>
              <div className={styles.specimenHead}>
                <span className={styles.specimenLabel}>Record specimen</span>
                <span className={styles.specimenSeq}>seq 0041</span>
              </div>

              <dl className={styles.rows}>
                <dt className={styles.k}>dev</dt>
                <dd className={styles.v}>0x4f2a…b91c</dd>
                <dt className={styles.k}>t</dt>
                <dd className={styles.v}>4.2 °C</dd>
                <dt className={styles.k}>h</dt>
                <dd className={styles.v}>82.0 %</dd>
                <dt className={styles.k}>lux</dt>
                <dd className={styles.v}>0</dd>
                <dt className={styles.k}>prev</dt>
                <dd className={styles.v}>0x9c07…41ea</dd>
                <dt className={styles.k}>digest</dt>
                <dd className={styles.v}>0xa31f…7d52</dd>
              </dl>

              <svg
                className={styles.spark}
                viewBox="0 0 260 52"
                preserveAspectRatio="none"
                role="img"
                aria-label="Twelve hours of temperature readings, all below the 10.0 degree breach threshold."
              >
                <rect x="0" y="0" width="260" height="14" fill="#e53e3e" opacity="0.10" />
                <line
                  x1="0"
                  y1="14"
                  x2="260"
                  y2="14"
                  stroke="#c8443a"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  opacity="0.55"
                />
                <polyline
                  points="0,36 20,34 40,37 60,33 80,35 100,32 120,36 140,34 160,33 180,36 200,34 220,35 240,33 260,34"
                  fill="none"
                  stroke="#17171c"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
              <p className={styles.sparkNote}>
                12 h · breach threshold 10.0 °C shaded
              </p>

              <div className={styles.specimenFoot}>
                <span className={styles.chipOk}>Verified</span>
                <p className={styles.specimenFootNote}>
                  Illustrative. The live record renders at /verify.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </section>

      {/* ---------- 02 pipeline ---------- */}
      <section className={styles.section}>
        <div className={styles.shell}>
          <span className={styles.num}>02</span>
          <h2 className={styles.sectionTitle}>Where the trust boundary sits</h2>
          <p className={styles.sectionLede}>
            Anyone can run a server and tell you the mangoes stayed cold. The point of this
            system is that you do not have to take our word for it — and neither does a judge.
          </p>

          <div className={styles.steps}>
            {PIPELINE.map((step) => (
              <article key={step.name} className={styles.step}>
                <span className={styles.stepNum}>{step.num}</span>
                <h3 className={styles.stepName}>{step.name}</h3>
                <p className={styles.stepBody}>{step.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- 03 the four states ---------- */}
      <section className={styles.section}>
        <div className={styles.shell}>
          <span className={styles.num}>03</span>
          <h2 className={styles.sectionTitle}>Four states, and one of them is failure</h2>
          <p className={styles.sectionLede}>
            A traceability system that can only say &ldquo;verified&rdquo; is a marketing asset.
            Failing loudly is the product.
          </p>

          <div className={styles.states}>
            {STATES.map((state) => (
              <article key={state.name} className={styles.state}>
                <div className={styles.stateTop}>
                  <span className={styles.dot} style={{ background: state.color }} />
                  <span className={styles.stateName} style={{ color: state.color }}>
                    {state.name}
                  </span>
                </div>
                <p className={styles.stateBody}>{state.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- 04 spec sheet ---------- */}
      <section className={styles.section}>
        <div className={styles.shell}>
          <span className={styles.num}>04</span>
          <h2 className={styles.sectionTitle}>The technical reality</h2>
          <p className={styles.sectionLede}>
            Nothing here is aspirational. These are the values the firmware, the gateway and the
            contracts are tested against.
          </p>

          <div className={styles.spec}>
            {SPEC.map((row) => (
              <div key={row.k} className={styles.specRow}>
                <span className={styles.specKey}>{row.k}</span>
                <span className={styles.specVal}>
                  {row.v}
                  {row.note ? <span className={styles.specNote}> — {row.note}</span> : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- 05 run it ---------- */}
      <section className={styles.section}>
        <div className={styles.shell}>
          <span className={styles.num}>05</span>
          <h2 className={styles.sectionTitle}>Run it without hardware</h2>
          <p className={styles.sectionLede}>
            The whole pipeline is demonstrable on one laptop, with the network unplugged.
          </p>

          <div className={styles.runGrid}>
            <div className={styles.cmdBlock}>
              <code className={styles.cmdLine}>
                <span className={styles.prompt}>$ </span>npm run chain
              </code>
              <code className={styles.cmdLine}>
                <span className={styles.prompt}>$ </span>npm run deploy:local
              </code>
              <code className={styles.cmdLine}>
                <span className={styles.prompt}>$ </span>npm run dev:gateway
              </code>
              <code className={styles.cmdLine}>
                <span className={styles.prompt}>$ </span>npm run seed
                <span className={styles.cmdNote}>{"   # three farms into one truck"}</span>
              </code>
            </div>

            <div className={styles.runAside}>
              <p>
                <span className={styles.mono}>seed</span> stages the story worth watching: three
                smallholdings load one truck, one crate warms up on the way, and the flag
                propagates to the shipment it was mixed into.
              </p>
              <ul className={styles.lotLinks}>
                <li>
                  <a className={styles.lotLink} href={`/verify/${SEED_LOT}`}>
                    <span className={styles.lotLinkLabel}>Truck lot · npm run seed</span>
                    {SEED_LOT}
                  </a>
                </li>
                <li>
                  <a className={styles.lotLink} href={`/verify/${SIM_LOT}`}>
                    <span className={styles.lotLinkLabel}>Single node · npm run sim</span>
                    {SIM_LOT}
                  </a>
                </li>
                <li>
                  <a className={styles.lotLink} href="/ops">
                    <span className={styles.lotLinkLabel}>Operations</span>
                    Node health, buffer depth and incidents
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.shell}>
          <p>
            Anchored on a local chain for this build. A public testnet mirror was implemented and
            then deliberately cut — the cryptography is identical either way, but a judge
            checking a root on infrastructure we do not own is a stronger claim, and we would
            rather say which one we are making.
          </p>
        </div>
      </footer>
    </main>
  );
}
