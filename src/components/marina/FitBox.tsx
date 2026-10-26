"use client";
import { fitCheck } from "@/lib/marina/fit";

// Oct 26 (per Mely): "Does it fit?" — the boat against the slip limits the marina set.
export default function FitBox({ slip, length, beam, draft, power }: { slip: Parameters<typeof fitCheck>[0]; length: number; beam?: number | null; draft?: number | null; power?: string | null }) {
  if (!(length > 0)) return null;
  const f = fitCheck(slip, { length, beam: beam || null, draft: draft || null, power: power || null });
  return (
    <div className={`mr-fit ${f.fits ? "ok" : "no"}`} role="status">
      <b>{f.fits ? "✓ Your boat fits this slip" : "✕ Your boat doesn't fit this slip"}</b>
      <ul>{f.checks.map((c) => <li key={c.key} className={c.ok ? "ok" : "no"}>{c.ok ? "✓" : "✕"} {c.label}: {c.detail}</li>)}</ul>
      {!beam && !draft && f.fits && <small>Add your beam and draft to check those too.</small>}
    </div>
  );
}
