/**
 * The swarm seam — ticket S1-15, ADR-0004 §2-§5.
 *
 * This file is a contract between three people, so it is deliberately all types and pure
 * functions with no behaviour: S1 publishes these shapes, S2 renders them, H1 and H2 emit
 * the records and companions behind them. If it is not in here, the dashboard should not
 * be reading it.
 *
 * Topics are versioned (`krishi/v1/...`) for the same reason the record is: the day we
 * change a payload shape mid-hackathon, a stale browser tab must fail visibly rather than
 * render half-parsed nonsense.
 */

import type { CompanionKindValue } from "./companion.js";
import type { BreachSignal, FindingKind, FindingSeverity } from "./consensus.js";
import type { ChainVerdict } from "./chain.js";
import type { Hex } from "./types.js";

/** What a device is for. One record format, four jobs (ADR-0004 §2). */
export const NodeRole = {
  /** ESP32 DevKit: senses, buffers, receives ESP-NOW from leafs and forwards over WiFi. */
  HEAD: "HEAD",
  /** ESP32-S2 Lolin: senses and sends over ESP-NOW, WiFi direct only as fallback. */
  LEAF: "LEAF",
  /** ESP32-CAM: photo hash and lid verdict as companions. Witnesses, does not sense. */
  WITNESS: "WITNESS",
  /** Phone PWA: GPS, IMU and camera backup over WiFi. No ESP-NOW radio exists on a phone. */
  VIRTUAL: "VIRTUAL",
} as const;

export type NodeRoleValue = (typeof NodeRole)[keyof typeof NodeRole];

/**
 * What a relay adds when it forwards someone else's batch.
 *
 * A HEAD never rewrites `dev`, `sig`, `seq` or `prev` — end-to-end verification has to hold
 * against the ORIGIN device's key, or the relay becomes a trusted party and the thesis of
 * the project collapses. Everything here is therefore routing metadata: useful for the map
 * and the health view, never an input to whether a record is believed.
 */
export interface RelayInfo {
  /** Address of the forwarding node. */
  by: Hex;
  /** Signal strength the relay saw, dBm. Drives "nearest node" custody follow. */
  rssi?: number;
  /** Hops so far. 1 for LEAF to HEAD to gateway. */
  hops: number;
  /** Relay's clock when it received the batch, unix seconds. */
  recvTs?: number;
}

/** The four badge states of S2-04. Defined here so the gateway and the web app cannot drift. */
export const Badge = {
  /** Signature, chain and Merkle inclusion all check out against an on-chain root. */
  VERIFIED: "VERIFIED",
  /** Verified locally, but the batch has not been anchored yet. Honest intermediate state. */
  PENDING_ANCHOR: "PENDING_ANCHOR",
  /** A breach was recorded against this lot. The data is sound; the produce is not. */
  FLAGGED: "FLAGGED",
  /** We cannot vouch for this: a chain gap, a fork, or a proof that does not verify. */
  UNVERIFIABLE: "UNVERIFIABLE",
} as const;

export type BadgeValue = (typeof Badge)[keyof typeof Badge];

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

export const MQTT_PREFIX = "krishi/v1";

export const Topics = {
  /** Every accepted record, as it lands. */
  record: (dev: Hex) => `${MQTT_PREFIX}/node/${dev.toLowerCase()}/record`,
  /** Heartbeat and node vitals. */
  health: (dev: Hex) => `${MQTT_PREFIX}/node/${dev.toLowerCase()}/health`,
  /** Companion attestations from a witness. */
  companion: (dev: Hex) => `${MQTT_PREFIX}/node/${dev.toLowerCase()}/companion`,
  /** Rolled-up state of one lot: badge, temperature, custody. Retained. */
  lot: (lot: Hex) => `${MQTT_PREFIX}/lot/${lot.toLowerCase()}/state`,
  /** Incidents: gaps, forks, breaches. */
  incident: `${MQTT_PREFIX}/incident`,
  /** Batch closed and anchored. */
  anchor: `${MQTT_PREFIX}/anchor`,
  /** Gateway to node: adaptive sampling and lot binding. */
  command: (dev: Hex) => `${MQTT_PREFIX}/cmd/${dev.toLowerCase()}`,

  /** Wildcards, for the dashboard's subscriptions. */
  allRecords: `${MQTT_PREFIX}/node/+/record`,
  allHealth: `${MQTT_PREFIX}/node/+/health`,
  allCompanions: `${MQTT_PREFIX}/node/+/companion`,
  allLots: `${MQTT_PREFIX}/lot/+/state`,
} as const;

// ---------------------------------------------------------------------------
// Payloads. All JSON; bigints are serialised as decimal strings, never as numbers,
// because a unix-second timestamp is fine in a double but a digest is not and the
// distinction is easy to lose in review.
// ---------------------------------------------------------------------------

export interface RecordEvent {
  dev: Hex;
  role: NodeRoleValue;
  seq: number;
  digest: Hex;
  lot: Hex;
  /** Device time, unix seconds, as a string. */
  ts: string;
  tsq: number;
  t: number;
  h: number;
  lux: number;
  flags: number;
  bat: number;
  /** What the chain state machine made of it. */
  verdict: ChainVerdict;
  /** Present when this record reached us via a relay. */
  relay?: RelayInfo;
  /** Gateway wall clock on ingest, milliseconds. */
  receivedAt: number;
}

export interface HealthEvent {
  dev: Hex;
  role: NodeRoleValue;
  /** False once the node misses its expected heartbeat. Greys the twin (S2-12). */
  online: boolean;
  /** Highest seq we have accepted. */
  lastSeq: number | null;
  /** Gateway wall clock of the last thing we heard, milliseconds. */
  lastSeenAt: number;
  /** Records the node says it is still holding. */
  bufferDepth?: number;
  rssi?: number;
  bat?: number;
  /** Current sampling interval in seconds — the adaptive-sampling behaviour, observable. */
  intervalSeconds?: number;
  /** Last known position, decimal degrees. Phones supply this; fixed nodes are surveyed. */
  lat?: number;
  lon?: number;
}

export interface CompanionEvent {
  dev: Hex;
  kind: CompanionKindValue;
  digest: Hex;
  subjectDev: Hex;
  subjectSeq: number;
  subject: Hex;
  flags: number;
  payload: Hex;
  ts: string;
  /** Lot of the subject record, or null when the subject has not arrived yet. */
  lot: Hex | null;
  /** Whether the companion's signature verified against its own device key. */
  verified: boolean;
  receivedAt: number;
}

export interface LotStateEvent {
  lot: Hex;
  badge: BadgeValue;
  recordCount: number;
  /** Most recent temperature, deci-degrees C. */
  lastTempDeciC: number | null;
  minTempDeciC: number | null;
  maxTempDeciC: number | null;
  flagged: boolean;
  /** Distinct devices contributing to this lot. */
  devices: Hex[];
  /** Signal classes currently corroborating a breach, if any. */
  signals: BreachSignal[];
  updatedAt: number;
}

export interface IncidentEvent {
  id: string;
  kind: FindingKind | ChainVerdict;
  severity: FindingSeverity;
  lot: Hex | null;
  dev: Hex | null;
  signals: BreachSignal[];
  devices: Hex[];
  evidence: Hex[];
  /** Device time of the completing observation, unix seconds. */
  at: number;
  detail: string;
  /** Whether this incident resulted in an on-chain flagLot call. */
  flagged: boolean;
  receivedAt: number;
}

export interface AnchorEvent {
  index: number;
  root: Hex;
  prevRoot: Hex;
  leafCount: number;
  closedAt: number;
  reason: "size" | "time" | "manual";
  /** Anchoring is asynchronous, so the dashboard shows the transition rather than a gap. */
  status: "PENDING" | "ANCHORED" | "FAILED";
  chainId?: number;
  txHash?: Hex;
  blockNumber?: string;
  error?: string;
}

/** Gateway to node. The adaptive-sampling half of ADR-0004 §4. */
export interface CommandEvent {
  cmd: "INTERVAL" | "BIND_LOT" | "PING";
  /** For INTERVAL: the new sampling period in seconds. */
  seconds?: number;
  /** For BIND_LOT: the lot the node should start stamping onto its records. */
  lot?: Hex;
  issuedAt: number;
  /** Why the gateway is asking. Shown in the ops log so the behaviour is explainable. */
  reason: string;
}

/**
 * Which badge a lot deserves.
 *
 * Order matters and is a product decision, not an implementation detail. `UNVERIFIABLE`
 * outranks `FLAGGED`: if the chain has a hole we cannot honestly claim to know that the
 * produce went bad, only that we cannot account for it. Claiming the stronger, more
 * specific finding on top of missing data would be the exact dishonesty this project
 * exists to make impossible (CLAUDE.md invariant 5).
 */
export function badgeFor(input: {
  hasGapOrFork: boolean;
  proofVerified: boolean;
  anchored: boolean;
  flagged: boolean;
}): BadgeValue {
  if (input.hasGapOrFork) return Badge.UNVERIFIABLE;
  if (input.anchored && !input.proofVerified) return Badge.UNVERIFIABLE;
  if (input.flagged) return Badge.FLAGGED;
  if (!input.anchored) return Badge.PENDING_ANCHOR;
  return Badge.VERIFIED;
}
