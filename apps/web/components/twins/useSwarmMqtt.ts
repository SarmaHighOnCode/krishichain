"use client";

/**
 * Ticket S2-12 — the MQTT-WS seam for the twins dashboard.
 *
 * Connects once on mount, subscribes to the retained health/lot topics plus the live incident
 * feed, and keeps `Map<Hex, ...>` state keyed off the payload's own `dev`/`lot` field — never
 * off the topic string, because the topics we subscribe to are wildcards
 * (`krishi/v1/node/+/health`) and MQTT.js hands us the *concrete* topic per message, not a
 * decoded set of wildcard captures.
 *
 * docs/SWARM-API.md's two rules this hook exists to respect:
 *   - `online` is computed by the gateway (5 s silence timeout) and republished every 2.5 s.
 *     This hook never runs its own staleness timer — it renders whatever `HealthEvent.online`
 *     says, full stop.
 *   - health and lot-state topics are retained, so a browser opening mid-demo gets current
 *     state on subscribe, before any *new* event fires. This hook doesn't distinguish a
 *     retained replay from a live update — both just update the map — so "nothing yet" only
 *     ever means "the broker truly has nothing retained for this topic," not "still loading."
 */

import { useEffect, useRef, useState } from "react";
import mqtt, { type MqttClient } from "mqtt";

import { Topics, type Hex, type HealthEvent, type IncidentEvent, type LotStateEvent } from "@krishichain/core";

const MQTT_WS_URL = process.env.NEXT_PUBLIC_MQTT_WS_URL ?? "ws://localhost:9001";

/** Mirrors the honesty split OpsDashboard.tsx uses for its own poll: "live" vs a visibly
 *  different "we lost it, still trying" state — never a silently stale render. */
export type ConnectionStatus = "connecting" | "live" | "reconnecting" | "error";

export interface SwarmState {
  status: ConnectionStatus;
  health: Map<Hex, HealthEvent>;
  lots: Map<Hex, LotStateEvent>;
  incidents: IncidentEvent[];
}

const MAX_INCIDENTS = 30;

export function useSwarmMqtt(): SwarmState {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [health, setHealth] = useState<Map<Hex, HealthEvent>>(new Map());
  const [lots, setLots] = useState<Map<Hex, LotStateEvent>>(new Map());
  const [incidents, setIncidents] = useState<IncidentEvent[]>([]);
  const clientRef = useRef<MqttClient | null>(null);

  useEffect(() => {
    const client = mqtt.connect(MQTT_WS_URL, {
      reconnectPeriod: 2000,
      connectTimeout: 8000,
    });
    clientRef.current = client;

    client.on("connect", () => {
      setStatus("live");
      client.subscribe([Topics.allHealth, Topics.allLots, Topics.incident], (err) => {
        if (err) setStatus("error");
      });
    });

    // A dropped connection must show as "reconnecting", never keep the last badge/marker
    // state on screen looking live (CLAUDE.md #5 — the same honesty principle that governs
    // UNVERIFIABLE applies to "is this feed actually current").
    client.on("reconnect", () => setStatus("reconnecting"));
    client.on("close", () => setStatus((s) => (s === "connecting" ? s : "reconnecting")));
    client.on("offline", () => setStatus("reconnecting"));
    client.on("error", () => setStatus("error"));

    client.on("message", (topic, payload) => {
      let data: unknown;
      try {
        data = JSON.parse(payload.toString());
      } catch {
        return; // Malformed payload: drop it, never crash the render on bad JSON.
      }

      if (topic === Topics.incident) {
        setIncidents((prev) => [data as IncidentEvent, ...prev].slice(0, MAX_INCIDENTS));
        return;
      }
      if (topic.endsWith("/health")) {
        const event = data as HealthEvent;
        setHealth((prev) => {
          const next = new Map(prev);
          next.set(event.dev, event);
          return next;
        });
        return;
      }
      if (topic.endsWith("/state")) {
        const event = data as LotStateEvent;
        setLots((prev) => {
          const next = new Map(prev);
          next.set(event.lot, event);
          return next;
        });
        return;
      }
    });

    return () => {
      clientRef.current = null;
      client.end(true);
    };
  }, []);

  return { status, health, lots, incidents };
}
