// Oct 27 (per Mely — "las letras se ven muy grandes, amontonadas"): each slip's label is sized to fit
// inside its own shape on screen, turned along the shape's long side, shortened to just the number
// ("A-12" → "12") when the full name doesn't fit, and hidden when even that would be unreadable
// (the name still shows on hover / tap).
export type LabelFit = { size: number; text: string; angle: number } | null;

export function fitSlipLabel(points: [number, number][], widthPx: number, heightPx: number, name: string, max = 12): LabelFit {
  if (!points?.length || points.length < 3 || !widthPx || !heightPx) return null;
  const px = points.map(([x, y]) => [(x * widthPx) / 100, (y * heightPx) / 100]);
  // the two sides at the first corner give the shape's length and width (good for rectangles and near-rectangles)
  const side = (a: number[], b: number[]) => ({ len: Math.hypot(b[0] - a[0], b[1] - a[1]), ang: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI });
  const s1 = side(px[0], px[1]), s2 = side(px[1], px[2]);
  const long = s1.len >= s2.len ? s1 : s2, short = s1.len >= s2.len ? s2 : s1;
  let angle = long.ang;
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  if (Math.abs(angle) < 8) angle = 0;
  const fit = (text: string) => Math.min(max, short.len * 0.7, (long.len * 0.86) / (0.62 * Math.max(1, text.length)));
  let text = name;
  let size = fit(text);
  if (size < 8) {
    const num = name.split(/[-\s]/).pop() || name;
    if (num !== name) { const s = fit(num); if (s > size) { text = num; size = s; } }
  }
  if (size < 6) return null;
  return { size: Math.round(size * 10) / 10, text, angle: Math.round(angle) };
}
