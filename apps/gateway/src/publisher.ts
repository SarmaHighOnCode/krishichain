/**
 * MQTT fan-out — ticket S1-15.
 *
 * The gateway is the only component that has verified anything, so it is the only one
 * entitled to say what is true. Everything the dashboard renders comes from here, after
 * verification, never straight off the wire from a node.
 *
 * BEST EFFORT, ALWAYS. Publishing is fire-and-forget and every failure is swallowed to a
 * log line. A broker that is down, wedged or not started yet must never fail an ingest:
 * the record is verified, stored and anchored regardless, and the dashboard catches up
 * when the broker comes back. Losing the live view is a cosmetic failure; losing a
 * verified record is a permanent one. That asymmetry is why this file has no retries and
 * no queue.
 *
 * Lot state and node health are published RETAINED so a browser that connects halfway
 * through a demo immediately sees the current picture instead of an empty screen waiting
 * for the next event.
 */

import {
  Topics,
  type AnchorEvent,
  type CommandEvent,
  type CompanionEvent,
  type HealthEvent,
  type Hex,
  type IncidentEvent,
  type LotStateEvent,
  type RecordEvent,
} from "@krishichain/core";
import mqtt, { type MqttClient } from "mqtt";

export interface PublisherLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
}

export class SwarmPublisher {
  private client: MqttClient | undefined;
  private connected = false;
  private dropped = 0;

  constructor(
    private readonly url: string,
    private readonly log: PublisherLogger,
  ) {}

  /** Connect in the background. Never throws — the gateway starts either way. */
  start(): void {
    try {
      this.client = mqtt.connect(this.url, {
        clientId: `krishichain-gateway-${process.pid}`,
        reconnectPeriod: 2000,
        connectTimeout: 4000,
      });

      this.client.on("connect", () => {
        this.connected = true;
        this.log.info({ url: this.url, dropped: this.dropped }, "mqtt connected");
      });
      this.client.on("close", () => {
        this.connected = false;
      });
      this.client.on("error", (error) => {
        this.log.warn({ err: error.message }, "mqtt error — continuing without the live feed");
      });
    } catch (error) {
      this.log.warn({ err: String(error) }, "mqtt unavailable — continuing without the live feed");
    }
  }

  get isConnected(): boolean {
    return this.connected;
  }

  /** Messages we could not publish because the broker was away. Shown on /ops/summary. */
  get droppedCount(): number {
    return this.dropped;
  }

  private send(topic: string, payload: unknown, retain = false): void {
    if (!this.client || !this.connected) {
      this.dropped += 1;
      return;
    }
    try {
      this.client.publish(topic, JSON.stringify(payload), { qos: 0, retain });
    } catch (error) {
      this.dropped += 1;
      this.log.warn({ err: String(error), topic }, "mqtt publish failed");
    }
  }

  record(event: RecordEvent): void {
    this.send(Topics.record(event.dev), event);
  }

  health(event: HealthEvent): void {
    this.send(Topics.health(event.dev), event, true);
  }

  companion(event: CompanionEvent): void {
    this.send(Topics.companion(event.dev), event);
  }

  lot(event: LotStateEvent): void {
    this.send(Topics.lot(event.lot), event, true);
  }

  incident(event: IncidentEvent): void {
    this.send(Topics.incident, event);
  }

  anchor(event: AnchorEvent): void {
    this.send(Topics.anchor, event);
  }

  /** Gateway to node. The adaptive-sampling half of ADR-0004 §4. */
  command(dev: Hex, event: CommandEvent): void {
    this.send(Topics.command(dev), event);
  }

  close(): void {
    this.client?.end(true);
    this.connected = false;
  }
}
