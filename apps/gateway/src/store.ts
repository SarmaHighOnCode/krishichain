/**
 * Gateway state — tickets S1-06, S1-11, S1-14.
 *
 * In memory for now. Ticket S1-06 swaps the maps for SQLite; every method here is written
 * so that change is a rewrite of this file and nothing else, which is why the routes never
 * touch a collection directly.
 *
 * ORPHANED COMPANIONS. A CAM witness and the node it watches take different paths to the
 * gateway — one over ESP-NOW through a HEAD, the other over WiFi — so the attestation
 * routinely arrives before the record it attests to. Dropping those would silently delete
 * half the swarm's evidence on a busy network, and it would fail intermittently, which is
 * the worst way for it to fail. Unmatched companions are held in `orphans` and replayed
 * into the rules engine the moment their subject lands.
 */

import {
  badgeFor,
  ConsensusEngine,
  NodeRole,
  type BadgeValue,
  type ChainVerdict,
  type CompanionAttestation,
  type CompanionEvent,
  type Finding,
  type HealthEvent,
  type Hex,
  type ImuEvidence,
  type IncidentEvent,
  type LotStateEvent,
  type NodeRoleValue,
  type RelayInfo,
  type SensorRecord,
} from "@krishichain/core";

export interface StoredRecord {
  record: SensorRecord;
  digest: Hex;
  signature: Hex;
  verdict: ChainVerdict;
  detail?: string;
  relay?: RelayInfo;
  receivedAt: number;
}

export interface StoredCompanion {
  companion: CompanionAttestation;
  digest: Hex;
  signature: Hex;
  imu?: ImuEvidence;
  /** Lot of the subject record, resolved when the subject is known. */
  lot: Hex | null;
  receivedAt: number;
}

export interface QuarantineEntry {
  dev: Hex;
  seq: number;
  reason: string;
  detail?: string;
  receivedAt: number;
}

export interface NodeInfo {
  dev: Hex;
  role: NodeRoleValue;
  lastSeq: number | null;
  lastSeenAt: number;
  bufferDepth?: number;
  rssi?: number;
  bat?: number;
  intervalSeconds: number;
  lat?: number;
  lon?: number;
  /** Set when this node's records arrive via a relay rather than directly. */
  relayedBy?: Hex;
}

/** A node is considered offline after this long without a record or heartbeat. */
export const OFFLINE_AFTER_MS = 5000;

/** Default sampling interval, seconds. Drops on an incident (ADR-0004 §4). */
export const CALM_INTERVAL_SECONDS = 30;
export const ALERT_INTERVAL_SECONDS = 10;

let incidentCounter = 0;

export class GatewayStore {
  readonly records: StoredRecord[] = [];
  readonly companions: StoredCompanion[] = [];
  readonly quarantine: QuarantineEntry[] = [];
  readonly incidents: IncidentEvent[] = [];

  private readonly byLot = new Map<string, StoredRecord[]>();
  private readonly byDigest = new Map<string, StoredRecord>();
  private readonly nodes = new Map<string, NodeInfo>();
  /** Companions whose subject record has not arrived yet, keyed by subject digest. */
  private readonly orphans = new Map<string, StoredCompanion[]>();
  /** Lots flagged on-chain, so we do not call flagLot twice for one episode. */
  private readonly flaggedLots = new Set<string>();

  constructor(readonly consensus: ConsensusEngine) {}

  // -------------------------------------------------------------------------
  // Nodes
  // -------------------------------------------------------------------------

  seeNode(dev: Hex, patch: Partial<NodeInfo> = {}): NodeInfo {
    const key = dev.toLowerCase();
    const existing = this.nodes.get(key);
    const info: NodeInfo = {
      dev,
      role: NodeRole.HEAD,
      lastSeq: null,
      intervalSeconds: CALM_INTERVAL_SECONDS,
      ...existing,
      ...patch,
      lastSeenAt: Date.now(),
    };
    this.nodes.set(key, info);
    return info;
  }

  node(dev: Hex): NodeInfo | undefined {
    return this.nodes.get(dev.toLowerCase());
  }

  allNodes(): NodeInfo[] {
    return [...this.nodes.values()];
  }

  healthEvent(info: NodeInfo, now = Date.now()): HealthEvent {
    const event: HealthEvent = {
      dev: info.dev,
      role: info.role,
      online: now - info.lastSeenAt <= OFFLINE_AFTER_MS,
      lastSeq: info.lastSeq,
      lastSeenAt: info.lastSeenAt,
      intervalSeconds: info.intervalSeconds,
    };
    if (info.bufferDepth !== undefined) event.bufferDepth = info.bufferDepth;
    if (info.rssi !== undefined) event.rssi = info.rssi;
    if (info.bat !== undefined) event.bat = info.bat;
    if (info.lat !== undefined) event.lat = info.lat;
    if (info.lon !== undefined) event.lon = info.lon;
    return event;
  }

  // -------------------------------------------------------------------------
  // Records
  // -------------------------------------------------------------------------

  /**
   * Persist a verified record and run it through the rules engine.
   *
   * Returns any findings, including those completed by companions that were waiting on
   * this record — see the note at the top of the file.
   */
  addRecord(entry: StoredRecord): Finding[] {
    this.records.push(entry);
    this.byDigest.set(entry.digest.toLowerCase(), entry);

    const lotKey = entry.record.lot.toLowerCase();
    const forLot = this.byLot.get(lotKey);
    if (forLot) forLot.push(entry);
    else this.byLot.set(lotKey, [entry]);

    const info = this.seeNode(entry.record.dev, {
      lastSeq: entry.record.seq,
      bat: entry.record.bat,
      ...(entry.relay ? { relayedBy: entry.relay.by, rssi: entry.relay.rssi } : {}),
    });
    // A LEAF that failed over to talking to us directly is no longer being relayed, and
    // leaving the old HEAD's address on it would draw a hop on the map that no longer
    // exists — the one thing the failover demo is supposed to show.
    if (!entry.relay) delete info.relayedBy;

    const findings = this.consensus.observeRecord(entry.record, entry.digest);

    // Now that we know this record's lot, any companion that was waiting on it can finally
    // be counted as evidence.
    const waiting = this.orphans.get(entry.digest.toLowerCase());
    if (waiting) {
      this.orphans.delete(entry.digest.toLowerCase());
      for (const orphan of waiting) {
        orphan.lot = entry.record.lot;
        findings.push(
          ...this.consensus.observeCompanion(
            orphan.companion,
            orphan.digest,
            entry.record.lot,
            orphan.imu,
          ),
        );
      }
    }

    return findings;
  }

  recordsForLot(lot: Hex): StoredRecord[] {
    return this.byLot.get(lot.toLowerCase()) ?? [];
  }

  recordByDigest(digest: Hex): StoredRecord | undefined {
    return this.byDigest.get(digest.toLowerCase());
  }

  lots(): Hex[] {
    return [...this.byLot.keys()] as Hex[];
  }

  // -------------------------------------------------------------------------
  // Companions
  // -------------------------------------------------------------------------

  /** Persist a verified companion. Held as an orphan if its subject has not arrived. */
  addCompanion(entry: Omit<StoredCompanion, "lot">): { stored: StoredCompanion; findings: Finding[] } {
    const subject = this.recordByDigest(entry.companion.subject);
    const stored: StoredCompanion = { ...entry, lot: subject?.record.lot ?? null };
    this.companions.push(stored);

    this.seeNode(entry.companion.dev, { role: NodeRole.WITNESS });

    if (!subject) {
      const key = entry.companion.subject.toLowerCase();
      const pool = this.orphans.get(key);
      if (pool) pool.push(stored);
      else this.orphans.set(key, [stored]);
      return { stored, findings: [] };
    }

    const findings = this.consensus.observeCompanion(
      entry.companion,
      entry.digest,
      subject.record.lot,
      entry.imu,
    );
    return { stored, findings };
  }

  companionsFor(digest: Hex): StoredCompanion[] {
    return this.companions.filter((c) => c.companion.subject.toLowerCase() === digest.toLowerCase());
  }

  get orphanCount(): number {
    let total = 0;
    for (const pool of this.orphans.values()) total += pool.length;
    return total;
  }

  companionEvent(stored: StoredCompanion, verified: boolean): CompanionEvent {
    return {
      dev: stored.companion.dev,
      kind: stored.companion.kind,
      digest: stored.digest,
      subjectDev: stored.companion.subjectDev,
      subjectSeq: stored.companion.subjectSeq,
      subject: stored.companion.subject,
      flags: stored.companion.flags,
      payload: stored.companion.payload,
      ts: stored.companion.ts.toString(),
      lot: stored.lot,
      verified,
      receivedAt: stored.receivedAt,
    };
  }

  // -------------------------------------------------------------------------
  // Incidents and lot rollups
  // -------------------------------------------------------------------------

  recordIncident(event: Omit<IncidentEvent, "id" | "receivedAt">): IncidentEvent {
    incidentCounter += 1;
    const incident: IncidentEvent = {
      ...event,
      id: `inc-${incidentCounter}`,
      receivedAt: Date.now(),
    };
    this.incidents.push(incident);
    return incident;
  }

  /** True the first time a lot is flagged, so the on-chain call happens exactly once. */
  markFlagged(lot: Hex): boolean {
    const key = lot.toLowerCase();
    if (this.flaggedLots.has(key)) return false;
    this.flaggedLots.add(key);
    return true;
  }

  isFlagged(lot: Hex): boolean {
    return this.flaggedLots.has(lot.toLowerCase());
  }

  /**
   * Roll a lot up for the dashboard and the consumer page.
   *
   * `isAnchored` is injected rather than read here because anchoring lives in the batcher;
   * the store's job is to know what was observed, not what has been committed.
   */
  lotState(lot: Hex, isAnchored: (digest: Hex) => boolean): LotStateEvent {
    const records = this.recordsForLot(lot);
    const temps = records
      .map((r) => r.record.t)
      .filter((t) => t !== -32768 && Number.isFinite(t));

    const hasGapOrFork = records.some(
      (r) => r.verdict === "CHAIN_GAP" || r.verdict === "CHAIN_FORK",
    );
    const anchored = records.length > 0 && records.every((r) => isAnchored(r.digest));
    const flagged = this.isFlagged(lot);

    const snapshot = this.consensus.snapshot(
      lot,
      records.length > 0 ? Number(records[records.length - 1]!.record.ts) : 0,
    );

    const badge: BadgeValue = badgeFor({
      hasGapOrFork,
      // The gateway's own proofs always verify — it built them. The claim that matters is
      // the browser re-deriving the root from a public RPC, which is S2-03's job and is
      // deliberately not something we assert on its behalf here.
      proofVerified: true,
      anchored,
      flagged,
    });

    return {
      lot,
      badge,
      recordCount: records.length,
      lastTempDeciC: records.length > 0 ? records[records.length - 1]!.record.t : null,
      minTempDeciC: temps.length > 0 ? Math.min(...temps) : null,
      maxTempDeciC: temps.length > 0 ? Math.max(...temps) : null,
      flagged,
      devices: [...new Set(records.map((r) => r.record.dev.toLowerCase()))] as Hex[],
      signals: snapshot.signals,
      updatedAt: Date.now(),
    };
  }
}
