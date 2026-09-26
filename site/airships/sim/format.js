/* Number and unit formatting (en-CA). Presentation, but shared by the model's prose.
 */
export function fmt(n, d) { return n.toLocaleString("en-CA", { maximumFractionDigits: d === undefined ? 0 : d, minimumFractionDigits: 0 }); }

export function fmtHa(h) { return h >= 1 ? fmt(h) + " ha" : "under 1 ha"; }

export function fmtMin(m) {
  if (m < 90) return fmt(m, m < 10 ? 1 : 0) + " min";
  return fmt(Math.floor(m / 60)) + " h " + fmt(m % 60) + " min";
}

export function fmtT(t) {
  return t >= 100 ? fmt(t) + " t"
    : t.toLocaleString("en-CA", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " t";
}

/* ---------- the mission ------------------------------------------------------------------ */
