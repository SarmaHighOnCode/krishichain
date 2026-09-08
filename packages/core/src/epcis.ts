/**
 * GS1 EPCIS 2.0 projection. PRD §9.2.
 *
 * We do not invent an event vocabulary. EPCIS 2.0 (ratified June 2022, JSON-LD) is the
 * standard behind FSMA 204 and EUDR compliance, and its native `sensorElementList` is
 * designed for exactly our payload. Speaking it means a real supply-chain system could
 * ingest our events without a bespoke adapter — which is most of the difference between
 * a demo and a product.
 *
 * Ticket S1-12 completes this against the published JSON schema.
 */

import type { Hex, SensorRecord } from "./types.js";
import { Flags, SENSOR_FAULT_HUMIDITY, SENSOR_FAULT_TEMP, ZERO_LOT } from "./types.js";

export const EPCIS_CONTEXT = "https://ref.gs1.org/standards/epcis/2.0.0/epcis-context.jsonld";

export type BizStep =
  | "commissioning"
  | "packing"
  | "shipping"
  | "receiving"
  | "sensor_reporting"
  | "inspecting"
  | "retail_selling";

export type Disposition =
  | "active"
  | "in_progress"
  | "in_transit"
  | "damaged"
  | "sellable_accessible";

export interface EpcisSensorReport {
  type: "Temperature" | "RelativeHumidity" | "Illuminance";
  value: number;
  uom: "CEL" | "A93" | "LUX";
  deviceID: string;
  time: string;
}

export interface EpcisObjectEvent {
  "@context"?: string;
  type: "ObjectEvent";
  eventTime: string;
  eventTimeZoneOffset: string;
  action: "OBSERVE" | "ADD" | "DELETE";
  bizStep: BizStep;
  disposition: Disposition;
  epcList: string[];
  sensorElementList?: Array<{ sensorReport: EpcisSensorReport[] }>;
  /** KrishiChain extension: the evidence that makes the event checkable. */
  "krishi:digest"?: Hex;
  "krishi:timeQuality"?: number;
  "krishi:seq"?: number;
  /** Present on breach events: which rule fired. */
  "krishi:incident"?: string;
}

/** GS1 EPC URI for a lot. Real deployments carry an assigned GS1 company prefix. */
export function lotToEpcUri(lot: Hex, gtin = "08901234567890"): string {
  if (lot === ZERO_LOT) return "urn:krishichain:lot:unbound";
  return `urn:epc:class:lgtin:${gtin}.${lot.slice(2, 18)}`;
}

/** `urn:epc:id:giai` style identifier for a device. */
export function deviceToEpcUri(dev: Hex): string {
  return `urn:krishichain:device:${dev}`;
}

function isoTime(ts: bigint): string {
  return new Date(Number(ts) * 1000).toISOString();
}

/** Project one sensor record into an EPCIS ObjectEvent. */
export function recordToEpcisEvent(record: SensorRecord, digest?: Hex): EpcisObjectEvent {
  const breach = (record.flags & Flags.LID_OPEN) !== 0;
  const reports: EpcisSensorReport[] = [];
  const time = isoTime(record.ts);
  const deviceID = deviceToEpcUri(record.dev);

  if (record.t !== SENSOR_FAULT_TEMP) {
    reports.push({ type: "Temperature", value: record.t / 10, uom: "CEL", deviceID, time });
  }
  if (record.h !== SENSOR_FAULT_HUMIDITY) {
    reports.push({ type: "RelativeHumidity", value: record.h / 10, uom: "A93", deviceID, time });
  }
  reports.push({ type: "Illuminance", value: record.lux, uom: "LUX", deviceID, time });

  const event: EpcisObjectEvent = {
    type: "ObjectEvent",
    eventTime: time,
    eventTimeZoneOffset: "+00:00",
    action: "OBSERVE",
    bizStep: breach ? "inspecting" : "sensor_reporting",
    disposition: breach ? "damaged" : "in_transit",
    epcList: [lotToEpcUri(record.lot)],
    sensorElementList: [{ sensorReport: reports }],
    "krishi:timeQuality": record.tsq,
    "krishi:seq": record.seq,
  };
  if (digest) event["krishi:digest"] = digest;
  return event;
}

/**
 * Project a breach into its own EPCIS event — ticket S1-12.
 *
 * A recall system needs to see the finding, not re-derive it from a temperature series.
 * `inspecting` + `damaged` is the vocabulary EPCIS already has for exactly this, so we use
 * it rather than inventing a KrishiChain-specific step.
 */
export function incidentToEpcisEvent(
  lot: Hex,
  at: number,
  kind: string,
  evidence?: Hex,
): EpcisObjectEvent {
  const event: EpcisObjectEvent = {
    type: "ObjectEvent",
    eventTime: new Date(at * 1000).toISOString(),
    eventTimeZoneOffset: "+00:00",
    action: "OBSERVE",
    bizStep: "inspecting",
    disposition: "damaged",
    epcList: [lotToEpcUri(lot)],
    "krishi:incident": kind,
  };
  if (evidence) event["krishi:digest"] = evidence;
  return event;
}

/**
 * Aggregation: child lots rolled into a parent. The "forty smallholders' crates become one
 * shipment" event, and the one a recall traverses backwards.
 */
export function aggregationToEpcisEvent(
  parent: Hex,
  children: Hex[],
  at: number,
): Record<string, unknown> {
  return {
    type: "AggregationEvent",
    eventTime: new Date(at * 1000).toISOString(),
    eventTimeZoneOffset: "+00:00",
    action: "ADD",
    bizStep: "packing",
    disposition: "in_progress",
    parentID: lotToEpcUri(parent),
    childEPCs: children.map((child) => lotToEpcUri(child)),
  };
}

/** Wrap events in an EPCIS document. */
export function toEpcisDocument(events: EpcisObjectEvent[]): Record<string, unknown> {
  return {
    "@context": EPCIS_CONTEXT,
    type: "EPCISDocument",
    schemaVersion: "2.0",
    creationDate: new Date().toISOString(),
    epcisBody: { eventList: events },
  };
}
