/**
 * Ticket S2-12 — a single source of hex values for the badge palette, shared by the Leaflet
 * markers (CSS, can read `--status-*` custom properties directly) and the R3F crate twins
 * (WebGL, needs real color values — a CSS var string is not something three.js can parse).
 *
 * These are the *literal* values behind `--status-verified` / `--status-pending` /
 * `--status-flagged` / `--status-unverifiable` in apps/web/app/globals.css (S2-01/S2-10).
 * Keep them in sync by hand if that file's palette ever moves — there is no way to read a
 * resolved CSS custom property into a three.js `Color` without mounting first, and the crate
 * twins colors on the very first frame, before any DOM measurement could happen anyway.
 */

import { Badge, type BadgeValue } from "@krishichain/core";

export const BADGE_COLORS: Record<BadgeValue, string> = {
  [Badge.VERIFIED]: "#003c33", // --color-deep-green
  [Badge.PENDING_ANCHOR]: "#4a4a5c", // --color-slate-strong
  [Badge.FLAGGED]: "#9c3c17", // --status-flagged
  [Badge.UNVERIFIABLE]: "#b30000", // --color-error
};

/** Matching CSS class from globals.css's `.badge` family, for the 2D chips. */
export const BADGE_CLASS: Record<BadgeValue, string> = {
  [Badge.VERIFIED]: "badge--ok",
  [Badge.PENDING_ANCHOR]: "badge--pending",
  [Badge.FLAGGED]: "badge--flagged",
  [Badge.UNVERIFIABLE]: "badge--bad",
};

/** Human label for a badge, matching the vocabulary in docs/SWARM-API.md's badges table. */
export const BADGE_LABEL: Record<BadgeValue, string> = {
  [Badge.VERIFIED]: "Verified",
  [Badge.PENDING_ANCHOR]: "Pending anchor",
  [Badge.FLAGGED]: "Flagged",
  [Badge.UNVERIFIABLE]: "Unverifiable",
};

/**
 * Marker shape + accent per node role (ADR-0004 §2). Distinguishing by *shape* first means the
 * map still reads correctly for the colorblind, with color as a secondary cue drawn from the
 * dashboard shell's own palette (dashboard-theme.css) — not a new one invented for this ticket.
 */
export const ROLE_SHAPE: Record<string, "square" | "circle" | "triangle" | "diamond"> = {
  HEAD: "square",
  LEAF: "circle",
  WITNESS: "triangle",
  VIRTUAL: "diamond",
};

export const ROLE_COLOR: Record<string, string> = {
  HEAD: "#1c1e54", // --dash-navy-900
  LEAF: "#533afd", // --dash-primary
  WITNESS: "#665efd", // --dash-primary-soft
  VIRTUAL: "#64748d", // --dash-ink-mute
};

/** Flat grey for an offline node — deliberately outside the role palette so "grey" always
 *  reads as "offline", never as "this role happens to be grey". */
export const OFFLINE_COLOR = "#a8b0bd";
