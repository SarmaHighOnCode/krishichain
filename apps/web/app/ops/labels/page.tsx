"use client";

/**
 * Ticket S2-08 — QR + crate label sheet.
 *
 * A printable sheet of QR labels, one per crate/lot, each pointing at that lot's
 * `/verify/[lotId]` page (S2-02..S2-04). This ships alongside H2's physical crate prop; the web
 * half is fully self-contained — no gateway call, just URL construction + client-side QR
 * rendering, so it works with the demo's "no internet" invariant (CLAUDE.md #6) even if the
 * gateway is down.
 *
 * Lot ID format, per docs/PROTOCOL.md: `lot` is `bytes16` → `0x` + 32 hex chars (34 chars total).
 * Garbage input is flagged, never silently accepted or silently dropped — this feeds a label
 * printer, and a malformed QR on a physical crate is a demo-day landmine.
 */

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";

const LOT_ID_PATTERN = /^0x[0-9a-fA-F]{32}$/;

// Configurable base for the QR target URL, so a sheet can be printed for a deployed gateway/web
// origin without hardcoding localhost:3000. Falls back to the browser's own origin, which is
// almost always right for "print this from the machine that's also serving /verify/*".
const CONFIGURED_BASE_URL = process.env.NEXT_PUBLIC_WEB_BASE_URL;

interface LabelEntry {
  /** Normalized (lowercased) `0x…` lot id — the canonical form used in the QR URL and display. */
  id: string;
}

function normalizeLotId(raw: string): string {
  return raw.trim();
}

function isValidLotId(raw: string): boolean {
  return LOT_ID_PATTERN.test(raw);
}

/** Split on newlines and/or commas — a batch sheet is usually pasted from a spreadsheet column
 *  or a comma-separated scanner dump, so accept either. */
function splitEntries(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function truncateLotId(id: string): string {
  if (id.length <= 18) return id;
  return `${id.slice(0, 10)}…${id.slice(-6)}`;
}

function LabelCard({ id, url }: { id: string; url: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toString(url, { type: "svg", margin: 1 })
      .then((result) => {
        if (!cancelled) setSvg(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "QR generation failed");
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div className="label-card card">
      <div className="label-card__qr" aria-hidden={svg ? undefined : true}>
        {svg ? (
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        ) : error ? (
          <span className="badge badge--bad">QR failed</span>
        ) : (
          <span className="muted">generating…</span>
        )}
      </div>
      <code className="label-card__id" title={id}>
        {truncateLotId(id)}
      </code>
      <span className="label-card__caption muted">scan to verify this lot</span>
    </div>
  );
}

export default function LabelsPage() {
  const [textareaValue, setTextareaValue] = useState("");
  const [entries, setEntries] = useState<LabelEntry[]>([]);
  const [invalidLines, setInvalidLines] = useState<string[]>([]);
  const [origin, setOrigin] = useState<string>("");

  // window is only available client-side; this also re-reads if the tab's origin ever changes
  // (it won't in practice, but there's no reason to snapshot it at module-eval time).
  useEffect(() => {
    setOrigin(CONFIGURED_BASE_URL ?? window.location.origin);
  }, []);

  const baseUrl = origin.replace(/\/$/, "");

  function handleAdd() {
    const rawLines = splitEntries(textareaValue);
    const nextInvalid: string[] = [];
    const nextValid: string[] = [];

    for (const line of rawLines) {
      const normalized = normalizeLotId(line);
      if (isValidLotId(normalized)) {
        nextValid.push(normalized.toLowerCase());
      } else {
        nextInvalid.push(line);
      }
    }

    setEntries((prev) => {
      const seen = new Set(prev.map((e) => e.id));
      const merged = [...prev];
      for (const id of nextValid) {
        if (!seen.has(id)) {
          seen.add(id);
          merged.push({ id });
        }
      }
      return merged;
    });
    setInvalidLines(nextInvalid);
    setTextareaValue("");
  }

  function handleClear() {
    setEntries([]);
    setInvalidLines([]);
  }

  function handleRemove(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  const canPrint = entries.length > 0 && baseUrl.length > 0;

  return (
    <main className="labels-page-main">
      <div className="label-controls">
        <h1>Crate label sheet</h1>
        <p className="muted">
          Enter one or more lot IDs (<code>0x</code> + 32 hex chars, per{" "}
          <code>docs/PROTOCOL.md</code>), one per line or comma-separated. Each becomes a printable
          QR label pointing at that lot&apos;s <code>/verify/&lt;lotId&gt;</code> page.
        </p>

        <div className="card">
          <label htmlFor="lot-ids" style={{ display: "block", marginBottom: "var(--space-sm)" }}>
            <span className="eyebrow">Lot IDs</span>
          </label>
          <textarea
            id="lot-ids"
            value={textareaValue}
            onChange={(e) => setTextareaValue(e.target.value)}
            placeholder={
              "0x018f2c9a7b3d4e5f8091a2b3c4d5e6f7\n0x018f2c9a7b3d4e5f8091a2b3c4d5e6f8"
            }
            rows={5}
            style={{
              width: "100%",
              fontFamily: "var(--font-mono)",
              fontSize: "0.9rem",
              padding: "var(--space-md)",
              border: "1px solid var(--color-hairline)",
              borderRadius: "var(--radius-sm)",
              resize: "vertical",
            }}
          />
          <div
            style={{
              display: "flex",
              gap: "var(--space-md)",
              marginTop: "var(--space-lg)",
              alignItems: "center",
            }}
          >
            <button onClick={handleAdd} disabled={textareaValue.trim().length === 0}>
              Add to sheet
            </button>
            {entries.length > 0 && (
              <button
                onClick={handleClear}
                style={{ background: "transparent", color: "var(--color-error)" }}
              >
                Clear all
              </button>
            )}
            <span className="muted" style={{ marginLeft: "auto" }}>
              {entries.length} label{entries.length === 1 ? "" : "s"} on sheet
            </span>
          </div>

          {invalidLines.length > 0 && (
            <p style={{ marginBottom: 0, marginTop: "var(--space-lg)" }}>
              <span className="badge badge--flagged">
                {invalidLines.length} rejected — not a valid lot ID
              </span>
              <br />
              <span className="muted">
                Expected <code>0x</code> followed by exactly 32 hex characters. Got:{" "}
                {invalidLines.map((line, i) => (
                  <code key={i} style={{ marginRight: "var(--space-xs)" }}>
                    {line || "(blank)"}
                  </code>
                ))}
              </span>
            </p>
          )}
        </div>

        {entries.length > 0 && (
          <div style={{ marginBottom: "var(--space-lg)" }}>
            <button onClick={() => window.print()} disabled={!canPrint}>
              Print sheet
            </button>
          </div>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="muted label-controls">No labels yet — add lot IDs above.</p>
      ) : (
        <div className="label-grid">
          {entries.map(({ id }) => (
            <div key={id} className="label-grid__item">
              <LabelCard id={id} url={`${baseUrl}/verify/${id}`} />
              <button
                className="label-grid__remove"
                onClick={() => handleRemove(id)}
                title="Remove this label"
                aria-label={`Remove ${id}`}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .labels-page-main {
          max-width: 64rem;
        }

        .label-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: var(--space-lg);
        }

        .label-grid__item {
          position: relative;
        }

        .label-grid__remove {
          position: absolute;
          top: calc(var(--space-lg) * -1 + 6px);
          right: 6px;
          width: 24px;
          height: 24px;
          padding: 0;
          border-radius: var(--radius-full);
          font-size: 1rem;
          line-height: 1;
          background: var(--color-canvas);
          color: var(--color-slate);
          border: 1px solid var(--color-hairline);
        }

        .label-grid__remove:hover {
          background: var(--status-unverifiable-wash);
          color: var(--status-unverifiable);
        }

        .label-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: var(--space-sm);
          margin: 0;
          padding: var(--space-lg);
        }

        .label-card__qr {
          width: 100%;
          max-width: 140px;
          display: flex;
          justify-content: center;
          align-items: center;
          aspect-ratio: 1 / 1;
        }

        .label-card__qr svg {
          width: 100%;
          height: 100%;
        }

        .label-card__id {
          font-size: 0.8rem;
        }

        .label-card__caption {
          font-size: 0.75rem;
        }

        /* Print layout: hide the input form, lay labels out as a plain grid sized for a
           physical label sheet. Not a specific commercial SKU — a hackathon-grade grid that
           prints legibly and cuts cleanly, per the ticket's guidance not to over-engineer this. */
        @media print {
          .label-controls {
            display: none !important;
          }

          .labels-page-main {
            max-width: none;
            padding: 0;
            margin: 0;
          }

          .label-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 6mm;
          }

          .label-grid__remove {
            display: none;
          }

          .label-card {
            border: 1px solid #999;
            border-radius: 0;
            break-inside: avoid;
            page-break-inside: avoid;
            padding: 4mm;
          }

          .label-card__caption {
            display: none;
          }

          @page {
            size: A4;
            margin: 10mm;
          }
        }
      `}</style>
    </main>
  );
}
