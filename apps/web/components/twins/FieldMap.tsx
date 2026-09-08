"use client";

/**
 * Ticket S2-12 — the Leaflet field map. Loaded only via `next/dynamic({ ssr: false })` from
 * TwinsDashboard.tsx: Leaflet touches `window` at import time, which crashes a server render.
 *
 * No remote tile layer. CLAUDE.md invariant 6 — "the demo must work with no internet... never
 * make [it] depend on... a hosted API" — and `docs/PRD.md`'s NFR-09 ("full demo runs with no
 * internet") are hard requirements for this repo, and a `TileLayer` pointing at a public OSM
 * server is exactly a hosted-API dependency: on a bad venue connection it would leave the map a
 * blank grey rectangle with judges watching. Real GPS positions still place markers correctly
 * without it — only the satellite/street basemap imagery is skipped, not the functionality the
 * accept criteria actually asks for (marker presence, role, greying, popups). The backdrop
 * below is a plain offline-safe CSS field texture instead of fetched tiles.
 *
 * Leaflet's default marker PNGs also don't resolve under webpack/Next without asset-path
 * surgery — sidestepped entirely by drawing every marker as an inline-SVG `L.divIcon`, which
 * also lets each marker be colored/shaped by role and greyed by `online` for free.
 */

import { useMemo } from "react";
import { MapContainer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import type { HealthEvent } from "@krishichain/core";

import { OFFLINE_COLOR, ROLE_COLOR, ROLE_SHAPE } from "./colors";

/** The simulator's patch of farmland near Nashik (scripts/sim-swarm.ts's ORIGIN) — a sensible
 *  default center, not a hardcoded assumption: a real device reporting elsewhere still places
 *  its own marker correctly, it would just start the view off-center until panned/fit. */
const DEFAULT_CENTER: [number, number] = [19.9975, 73.7898];
const DEFAULT_ZOOM = 16;

function shapePath(shape: "square" | "circle" | "triangle" | "diamond"): string {
  switch (shape) {
    case "square":
      return `<rect x="4" y="4" width="16" height="16" rx="3" />`;
    case "circle":
      return `<circle cx="12" cy="12" r="9" />`;
    case "triangle":
      return `<path d="M12 3 21 20 3 20 Z" />`;
    case "diamond":
      return `<path d="M12 2 22 12 12 22 2 12 Z" />`;
  }
}

function markerIcon(role: string, online: boolean): L.DivIcon {
  const shape = ROLE_SHAPE[role] ?? "circle";
  const color = online ? (ROLE_COLOR[role] ?? "#533afd") : OFFLINE_COLOR;
  const html = `
    <svg width="26" height="26" viewBox="0 0 24 24" fill="${color}" stroke="#ffffff" stroke-width="1.5"
         style="filter: drop-shadow(0 1px 3px rgba(13,37,61,0.35)); opacity: ${online ? 1 : 0.75}">
      ${shapePath(shape)}
    </svg>`;
  return L.divIcon({
    html,
    className: "twins-marker",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -13],
  });
}

function truncate(hex: string): string {
  if (hex.length <= 14) return hex;
  return `${hex.slice(0, 8)}…${hex.slice(-4)}`;
}

export function FieldMap({ nodes }: { nodes: HealthEvent[] }) {
  const positioned = useMemo(
    () => nodes.filter((n): n is HealthEvent & { lat: number; lon: number } => typeof n.lat === "number" && typeof n.lon === "number"),
    [nodes],
  );

  const center = positioned.length > 0 ? ([positioned[0].lat, positioned[0].lon] as [number, number]) : DEFAULT_CENTER;

  return (
    <MapContainer
      center={center}
      zoom={DEFAULT_ZOOM}
      scrollWheelZoom={false}
      className="twins-field-map"
      style={{ height: "100%", width: "100%" }}
      attributionControl={false}
    >
      {positioned.map((node) => (
        <Marker key={node.dev} position={[node.lat, node.lon]} icon={markerIcon(node.role, node.online)}>
          <Popup>
            <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.78rem", lineHeight: 1.5 }}>
              <strong>{truncate(node.dev)}</strong>
              <br />
              role: {node.role}
              <br />
              status: {node.online ? "online" : "offline"}
              <br />
              last seen: {new Date(node.lastSeenAt).toLocaleTimeString()}
              <br />
              buffer depth: {node.bufferDepth ?? "—"}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
