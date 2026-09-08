/**
 * Rules engine and swarm consensus — tickets S1-10 and S1-14, ADR-0004 §4.
 *
 * A single sensor can be wrong. A DHT22 in direct sun reads high; a reed switch bounces; a
 * courier drops a crate without ever opening it. Flagging a farmer's consignment on one
 * noisy reading is a product failure, not a safety feature — and it is how most cold-chain
 * demos quietly cheat, because one spike makes a livelier stage moment.
 *
 * So there are two independent routes to a breach, and they trade off differently:
 *
 *   1. SUSTAINED  — one device, one signal, held for `sustainSeconds`. Slow but robust:
 *                   noise does not persist, a warm truck does.
 *   2. CONSENSUS  — `minSignalClasses` different KINDS of signal from `minDevices`
 *                   different devices inside `windowSeconds`. Fast and high-confidence:
 *                   a temperature climb corroborated by a CAM seeing the lid open and an
 *                   IMU feeling the crate move is not sensor noise, and waiting fifteen
 *                   minutes to say so would be negligent.
 *
 * Both call `flagLot`. Neither can be triggered by a lone spike, which is the acceptance
 * criterion for S1-14 and the honest behaviour regardless.
 *
 * WINDOWING ON DEVICE TIME, NOT ARRIVAL TIME. Records arrive in bursts: a node that was
 * offline for ten minutes drains its whole buffer in one POST. Correlating on arrival time
 * would collapse ten minutes of history into one instant and manufacture consensus out of
 * unrelated events. We correlate on the signed `ts` the device recorded at capture — which
 * is precisely why `ts` is inside the signed bytes. When a device admits it never synced
 * (`tsq === UNSYNCED`) its timestamp cannot establish co-occurrence, so its observations
 * still raise their own findings but are excluded from corroboration.
 */

import { CompanionFlags, type CompanionAttestation, type ImuEvidence } from "./companion.js";
import {
  Flags,
  SENSOR_FAULT_TEMP,
  TimeQuality,
  ZERO_LOT,
  type Hex,
  type SensorRecord,
} from "./types.js";

/** The three independent classes of evidence that a cold box has been compromised. */
export type BreachSignal =
  /** Temperature outside the permitted range. */
  | "TEMP"
  /** Lid or seal reported open — by a record flag or a CAM witness. */
  | "LID"
  /** Impact or unexpected motion — by a record flag or an IMU companion. */
  | "SHOCK";

export type FindingKind =
  /** Sustained single-source temperature excursion. Route 1. */
  | "COLD_CHAIN_BREACH"
  /** Corroborated across signal classes and devices. Route 2. */
  | "CONSENSUS_BREACH"
  /** Two signal classes, but only one device saw them. Reported, never auto-flagged. */
  | "SUSPECTED_BREACH"
  /** A single tamper signal. Visible on the ops dashboard; does not flag a lot. */
  | "TAMPER";

export type FindingSeverity = "info" | "warn" | "breach";

export interface Finding {
  kind: FindingKind;
  severity: FindingSeverity;
  lot: Hex;
  /** Signal classes that contributed. */
  signals: BreachSignal[];
  /** Distinct devices that contributed. */
  devices: Hex[];
  /** Digests of the records and companions that justify this finding. */
  evidence: Hex[];
  /** Device time of the observation that completed the finding, unix seconds. */
  at: number;
  /** Human-readable, and short enough for a dashboard row. */
  detail: string;
}

/** One piece of evidence, normalised from either a record or a companion. */
interface Observation {
  signal: BreachSignal;
  lot: Hex;
  dev: Hex;
  /** Device time, unix seconds. */
  at: number;
  /** Whether this observation may participate in corroboration. */
  correlatable: boolean;
  evidence: Hex;
}

export interface ConsensusConfig {
  /** Upper bound of the permitted range, deci-degrees C. 100 = 10.0 C. */
  tempMaxDeciC: number;
  /** Lower bound, deci-degrees C. */
  tempMinDeciC: number;
  /** How long a lone temperature excursion must hold before it is a breach. */
  sustainSeconds: number;
  /** Corroboration window for the consensus rule. */
  windowSeconds: number;
  /** How many distinct signal classes consensus needs. The "2" of 2-of-3. */
  minSignalClasses: number;
  /** How many distinct devices consensus needs. Independence, not just multiplicity. */
  minDevices: number;
  /** Peak acceleration above which an IMU companion counts as SHOCK, milli-g. */
  shockMilliG: number;
}

/**
 * Demo-tuned defaults. `sustainSeconds` is 30 rather than the production fifteen minutes
 * (.env `TEMP_BREACH_MINUTES`) so a breach lands inside the 60-120 s window the cold-box
 * rig produces on stage (H2-07). The consensus route is not time-tuned at all: it fires as
 * soon as the second class of evidence arrives, which is the point of building it.
 */
export const DEFAULT_CONSENSUS_CONFIG: ConsensusConfig = {
  tempMaxDeciC: 100,
  tempMinDeciC: 0,
  sustainSeconds: 30,
  windowSeconds: 60,
  minSignalClasses: 2,
  minDevices: 2,
  shockMilliG: 2000,
};

/** Per-lot latch, so one episode produces one finding rather than one per record. */
interface LotState {
  observations: Observation[];
  /** Kinds already reported for the current episode. */
  latched: Set<FindingKind>;
  /** Per-device start of an ongoing temperature excursion, device time. */
  excursionStart: Map<string, number>;
  /**
   * Device time after which silence means the corroboration episode is over.
   * Each observation pushes it out by one window; a gap longer than that starts a new
   * episode and re-arms the consensus findings.
   */
  episodeEndsAt: number;
}

/** Findings that describe a corroboration episode rather than a temperature excursion. */
const EPISODE_KINDS: FindingKind[] = ["CONSENSUS_BREACH", "SUSPECTED_BREACH", "TAMPER"];

function isUnbound(lot: Hex): boolean {
  return lot.toLowerCase() === ZERO_LOT;
}

/**
 * Stateful across records, pure with respect to I/O: it decides, the gateway acts. Same
 * split as the chain state machine, and for the same reason — the security-critical logic
 * runs identically in tests, in the simulator and in the live ingest path.
 */
export class ConsensusEngine {
  private readonly lots = new Map<string, LotState>();
  private readonly config: ConsensusConfig;

  constructor(config: Partial<ConsensusConfig> = {}) {
    this.config = { ...DEFAULT_CONSENSUS_CONFIG, ...config };
  }

  /** Feed a verified sensor record. Returns any findings it completed. */
  observeRecord(record: SensorRecord, digest: Hex): Finding[] {
    if (isUnbound(record.lot)) return [];

    const at = Number(record.ts);
    const correlatable = record.tsq !== TimeQuality.UNSYNCED;
    const findings: Finding[] = [];
    const state = this.lotState(record.lot);

    // A sensor fault is not a cold reading. SENSOR_FAULT_TEMP is -32768, which would sail
    // past a naive "below minimum" check and report a deep freeze that never happened.
    const faulted = (record.flags & Flags.SENSOR_FAULT) !== 0 || record.t === SENSOR_FAULT_TEMP;
    const outOfRange =
      !faulted && (record.t > this.config.tempMaxDeciC || record.t < this.config.tempMinDeciC);

    if (outOfRange) {
      findings.push(...this.observe(state, {
        signal: "TEMP",
        lot: record.lot,
        dev: record.dev,
        at,
        correlatable,
        evidence: digest,
      }));
      findings.push(...this.trackExcursion(state, record, digest, at));
    } else if (!faulted) {
      // Back in range: this device's excursion is over, so a genuinely new one later can be
      // reported again. Only the temperature finding is re-armed — an open lid does not
      // stop being an open lid because the thermometer recovered, and clearing the whole
      // latch here made one breach episode re-report on every cool reading that followed.
      state.excursionStart.delete(record.dev.toLowerCase());
      state.latched.delete("COLD_CHAIN_BREACH");
    }

    if (record.flags & Flags.LID_OPEN) {
      findings.push(...this.observe(state, {
        signal: "LID",
        lot: record.lot,
        dev: record.dev,
        at,
        correlatable,
        evidence: digest,
      }));
    }
    if (record.flags & Flags.SHOCK) {
      findings.push(...this.observe(state, {
        signal: "SHOCK",
        lot: record.lot,
        dev: record.dev,
        at,
        correlatable,
        evidence: digest,
      }));
    }

    return findings;
  }

  /**
   * Feed a verified companion attestation, along with the lot of the record it witnesses.
   *
   * The lot comes from the subject record rather than from the companion, because a CAM
   * bolted to a truck does not know which lot it is looking at — the record it witnesses
   * does. That is also why an unmatched companion contributes nothing: without a subject
   * we cannot say what it is evidence *about*.
   */
  observeCompanion(
    companion: CompanionAttestation,
    digest: Hex,
    lot: Hex,
    imu?: ImuEvidence,
  ): Finding[] {
    if (isUnbound(lot)) return [];

    const state = this.lotState(lot);
    const at = Number(companion.ts);
    const findings: Finding[] = [];

    if (companion.flags & CompanionFlags.LID_OPEN) {
      findings.push(...this.observe(state, {
        signal: "LID",
        lot,
        dev: companion.dev,
        at,
        correlatable: true,
        evidence: digest,
      }));
    }
    // The SHOCK bit is the device's verdict; the evidence is its own numbers. When the
    // numbers came with it, hold the verdict to them — a board whose threshold is
    // miscalibrated (or whose firmware is lying) should not be able to assert a breach
    // that its own signed measurements do not support. Absent evidence we take the bit,
    // because a witness with no accelerometer read-out is still a witness.
    const shockSupported =
      imu === undefined || imu.peakMilliG >= this.config.shockMilliG;

    if (companion.flags & CompanionFlags.SHOCK && shockSupported) {
      findings.push(...this.observe(state, {
        signal: "SHOCK",
        lot,
        dev: companion.dev,
        at,
        correlatable: true,
        evidence: digest,
      }));
    }

    return findings;
  }

  /** Current corroboration picture for a lot. Drives the ops dashboard panel. */
  snapshot(lot: Hex, now: number): { signals: BreachSignal[]; devices: Hex[] } {
    const state = this.lots.get(lot.toLowerCase());
    if (!state) return { signals: [], devices: [] };
    const recent = state.observations.filter(
      (o) => o.correlatable && now - o.at <= this.config.windowSeconds,
    );
    return {
      signals: [...new Set(recent.map((o) => o.signal))],
      devices: [...new Set(recent.map((o) => o.dev.toLowerCase()))] as Hex[],
    };
  }

  private lotState(lot: Hex): LotState {
    const key = lot.toLowerCase();
    let state = this.lots.get(key);
    if (!state) {
      state = { observations: [], latched: new Set(), excursionStart: new Map(), episodeEndsAt: 0 };
      this.lots.set(key, state);
    }
    return state;
  }

  /** Record an observation and re-evaluate the consensus rule over the current window. */
  private observe(state: LotState, obs: Observation): Finding[] {
    // A quiet stretch longer than the window ends the episode: what happens after it is a
    // new event, not a continuation, and deserves its own incident.
    if (obs.at > state.episodeEndsAt) {
      for (const kind of EPISODE_KINDS) state.latched.delete(kind);
    }
    state.episodeEndsAt = Math.max(state.episodeEndsAt, obs.at + this.config.windowSeconds);

    state.observations.push(obs);
    // Keep the window plus a margin. Bounded memory over a long run, and old evidence
    // cannot silently combine with new.
    const cutoff = obs.at - this.config.windowSeconds * 2;
    state.observations = state.observations.filter((o) => o.at >= cutoff);

    const findings: Finding[] = [];
    const window = state.observations.filter(
      (o) => o.correlatable && Math.abs(obs.at - o.at) <= this.config.windowSeconds,
    );

    const classes = [...new Set(window.map((o) => o.signal))];
    const devices = [...new Set(window.map((o) => o.dev.toLowerCase()))];

    if (classes.length >= this.config.minSignalClasses) {
      if (devices.length >= this.config.minDevices) {
        const finding = this.latch(state, {
          kind: "CONSENSUS_BREACH",
          severity: "breach",
          lot: obs.lot,
          signals: classes,
          devices: devices as Hex[],
          evidence: window.map((o) => o.evidence),
          at: obs.at,
          detail:
            `${classes.length}-of-3 corroborated across ${devices.length} devices ` +
            `within ${this.config.windowSeconds}s: ${classes.join(" + ")}`,
        });
        if (finding) findings.push(finding);
      } else {
        // Two classes, one device. That is a node reporting a coherent story about itself,
        // which is suggestive but not independent — a faulty or compromised board can say
        // anything. Surface it; never auto-flag on it.
        const finding = this.latch(state, {
          kind: "SUSPECTED_BREACH",
          severity: "warn",
          lot: obs.lot,
          signals: classes,
          devices: devices as Hex[],
          evidence: window.map((o) => o.evidence),
          at: obs.at,
          detail:
            `${classes.join(" + ")} from a single device — not independently corroborated`,
        });
        if (finding) findings.push(finding);
      }
    } else if (obs.signal !== "TEMP") {
      const finding = this.latch(state, {
        kind: "TAMPER",
        severity: "info",
        lot: obs.lot,
        signals: [obs.signal],
        devices: [obs.dev],
        evidence: [obs.evidence],
        at: obs.at,
        detail: `${obs.signal} reported by ${obs.dev.slice(0, 10)} — uncorroborated`,
      });
      if (finding) findings.push(finding);
    }

    return findings;
  }

  /** Route 1: one device, one signal, held long enough that noise is ruled out. */
  private trackExcursion(state: LotState, record: SensorRecord, digest: Hex, at: number): Finding[] {
    const key = record.dev.toLowerCase();
    const start = state.excursionStart.get(key);
    if (start === undefined) {
      state.excursionStart.set(key, at);
      return [];
    }
    if (at - start < this.config.sustainSeconds) return [];

    const finding = this.latch(state, {
      kind: "COLD_CHAIN_BREACH",
      severity: "breach",
      lot: record.lot,
      signals: ["TEMP"],
      devices: [record.dev],
      evidence: [digest],
      at,
      detail:
        `${(record.t / 10).toFixed(1)}C outside ` +
        `[${(this.config.tempMinDeciC / 10).toFixed(1)}, ${(this.config.tempMaxDeciC / 10).toFixed(1)}]C ` +
        `for ${at - start}s`,
    });
    return finding ? [finding] : [];
  }

  /** Emit a finding at most once per episode. Returns undefined if already reported. */
  private latch(state: LotState, finding: Finding): Finding | undefined {
    if (state.latched.has(finding.kind)) return undefined;
    // A confirmed breach supersedes the weaker findings that preceded it, and re-reporting
    // them afterwards would only add noise to the incident feed.
    if (finding.kind === "CONSENSUS_BREACH") {
      state.latched.add("SUSPECTED_BREACH");
      state.latched.add("TAMPER");
    }
    state.latched.add(finding.kind);
    return finding;
  }
}
