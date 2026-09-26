/* The viewer's stylesheet, as a string.
 *
 * Not a .css file, because pink-sites pages are self-contained and a linked stylesheet is a second
 * request and a second source of truth. `injectStyles()` puts it in the document once, keyed by an
 * id, so ten viewers on a page share one <style>.
 *
 * Everything here is expressed in the site's OWN custom properties with a fallback, so a page that
 * has already inlined the design foundation gets its tokens and a page that has not still renders.
 */

export const CSS = `
.a3d{position:relative;display:block;width:100%;min-height:280px;
  /* The site's radial atmosphere, behind a transparent canvas: it gives the hull something to be
     a silhouette against without costing a shader or a draw call. */
  background:radial-gradient(120% 90% at 62% 34%,#16161c 0%,#101014 46%,#0a0a0c 100%);
  border:1px solid var(--line,#232329);border-radius:3px;overflow:hidden}
.a3d-canvas{display:block;width:100%;height:100%;position:absolute;inset:0;touch-action:none;
  cursor:grab}
.a3d-canvas:active{cursor:grabbing}
.a3d-canvas:focus-visible{outline:2px solid var(--warm,#ff4fa3);outline-offset:-2px}
.a3d-overlay{position:absolute;inset:0;pointer-events:none;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.a3d-caption{position:absolute;left:10px;bottom:8px;right:10px;font-size:10.5px;line-height:1.45;
  color:var(--faint,#74747f)}
.a3d-legend{position:absolute;right:10px;top:8px;display:flex;flex-direction:column;gap:3px;
  align-items:flex-end;font-size:10.5px;color:var(--muted,#9a9aa5)}
.a3d-legend-row{display:inline-flex;align-items:center;gap:6px}
.a3d-swatch{width:14px;height:3px;border-radius:1px;display:inline-block}
.a3d-labels{position:absolute;inset:0}
.a3d-label{position:absolute;transform:translate(-50%,-140%);padding:2px 6px;font-size:10.5px;
  color:var(--text,#e8e8ea);background:rgba(10,10,12,.82);border:1px solid var(--line,#232329);
  border-radius:2px;white-space:nowrap}
.a3d-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);
  clip-path:inset(50%);white-space:nowrap}
.a3d-fallback{padding:8px}
.a3d-fallback-note{font-size:12px;color:var(--faint,#74747f);margin:6px 2px 0;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace}

.a3d-scene{display:grid;gap:12px}
.a3d-scene .a3d-stage{position:relative;min-height:340px}
.a3d-cutaway,.a3d-authority,.a3d-failure{grid-template-columns:minmax(0,1.6fr) minmax(240px,1fr)}
@media (max-width:820px){.a3d-cutaway,.a3d-authority,.a3d-failure{grid-template-columns:1fr}}
.a3d-side{display:flex;flex-direction:column;gap:10px;min-width:0}
.a3d-controls,.a3d-row{display:flex;flex-wrap:wrap;gap:6px}
.a3d-controls{flex-direction:column}
.a3d-bar{display:flex;flex-direction:column;gap:8px}

.a3d-btn,.a3d-chip{font:inherit;font-size:11.5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  color:var(--muted,#9a9aa5);background:transparent;border:1px solid var(--line,#232329);
  border-radius:2px;padding:4px 9px;cursor:pointer;line-height:1.4}
.a3d-btn:hover,.a3d-chip:hover{color:var(--text,#e8e8ea);border-color:var(--line-strong,#33333c)}
.a3d-btn[aria-pressed=true]{color:var(--warm,#ff4fa3);border-color:var(--warm-dim,#8c2a58)}
.a3d-chip{padding-left:20px;position:relative}
.a3d-chip::before{content:"";position:absolute;left:7px;top:50%;width:7px;height:7px;
  margin-top:-3.5px;border-radius:1px;background:var(--chip,#74747f);opacity:.5}
.a3d-chip[aria-pressed=true]{color:var(--text,#e8e8ea);border-color:var(--line-strong,#33333c)}
.a3d-chip[aria-pressed=true]::before{opacity:1}
.a3d-btn:focus-visible,.a3d-chip:focus-visible,.a3d-range:focus-visible,.a3d-select:focus-visible{
  outline:2px solid var(--warm,#ff4fa3);outline-offset:2px}

.a3d-range{flex:1 1 160px;min-width:120px;accent-color:var(--warm,#ff4fa3);background:transparent}
.a3d-select{font:inherit;font-size:11.5px;font-family:ui-monospace,monospace;
  color:var(--muted,#9a9aa5);background:var(--panel,#111114);border:1px solid var(--line,#232329);
  border-radius:2px;padding:3px 6px}
.a3d-timeline{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.a3d-readout,.a3d-info{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;
  color:var(--faint,#74747f);line-height:1.5}
.a3d-readout{flex:1 1 100%}

.a3d-panel{border-top:1px solid var(--line,#232329);padding-top:10px;min-width:0}
.a3d-panel-title,.a3d-detail-title{font-family:ui-monospace,monospace;font-size:11px;
  letter-spacing:.09em;text-transform:uppercase;color:var(--faint,#74747f);margin:0 0 6px}
.a3d-detail-title{text-transform:none;letter-spacing:0;font-size:13.5px;
  color:var(--text,#e8e8ea);font-weight:600}
.a3d-detail-body{font-size:13px;line-height:1.6;color:var(--muted,#9a9aa5);margin:8px 0}
.a3d-list{display:flex;flex-direction:column;gap:2px;max-height:260px;overflow:auto}
.a3d-list-row{display:flex;justify-content:space-between;gap:8px;text-align:left;font:inherit;
  font-size:12px;font-family:ui-monospace,monospace;color:var(--muted,#9a9aa5);background:none;
  border:0;border-left:2px solid var(--chip,#74747f);padding:3px 6px;cursor:pointer}
.a3d-list-row:hover{color:var(--text,#e8e8ea);background:rgba(255,255,255,.03)}
.a3d-list-count{color:var(--faint,#74747f)}
.a3d-cat,.a3d-claim{display:inline-block;font-family:ui-monospace,monospace;font-size:10px;
  letter-spacing:.06em;text-transform:uppercase;padding:2px 6px;border-radius:2px;
  border:1px solid currentColor;margin:0 6px 6px 0}
.a3d-cat{color:var(--chip,#74747f)}
.a3d-claim[data-claim=future-research]{color:var(--warm,#ff4fa3)}
.a3d-claim[data-claim=known-physics]{color:var(--bone,#c9c3b6)}
.a3d-claim[data-claim=reference-assumption]{color:var(--cool,#7aa2c8)}
.a3d-claim[data-claim=conceptual-layout]{color:var(--faint,#74747f)}
.a3d-facts{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;margin:8px 0;font-size:11.5px;
  font-family:ui-monospace,monospace}
.a3d-facts dt{color:var(--faint,#74747f)}
.a3d-facts dd{margin:0;color:var(--muted,#9a9aa5)}
.a3d-hint,.a3d-note{font-size:11.5px;line-height:1.55;color:var(--faint,#74747f);margin:8px 0 0;
  font-family:ui-monospace,monospace}
.a3d-question{font-size:14px;line-height:1.6;color:var(--text,#e8e8ea);margin:0 0 10px}
.a3d-table{width:100%;border-collapse:collapse;font-family:ui-monospace,monospace;font-size:11.5px;
  margin-top:10px}
.a3d-table caption{text-align:left;color:var(--faint,#74747f);font-size:11px;padding-bottom:6px}
.a3d-table th,.a3d-table td{text-align:right;padding:4px 8px;border-bottom:1px solid var(--line,#232329);
  color:var(--muted,#9a9aa5)}
.a3d-table thead th{color:var(--faint,#74747f);font-weight:600}
.a3d-table tbody th{text-align:left;color:var(--warm,#ff4fa3)}
.a3d-readout-block{border-top:1px solid var(--line,#232329);padding-top:8px}

@media (prefers-reduced-motion: reduce){
  .a3d-canvas{cursor:default}
}
`;

/** Put the stylesheet in the document once. Safe to call from every scene. */
export function injectStyles(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return null;
  const ID = 'airship3d-styles';
  let s = doc.getElementById(ID);
  if (s) return s;
  s = doc.createElement('style');
  s.id = ID;
  s.textContent = CSS;
  doc.head.appendChild(s);
  return s;
}
