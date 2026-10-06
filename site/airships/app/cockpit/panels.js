/* The focused ship: forces, instruments, the power ledger and the mission trace.
 */
import { CFG, MODEL_STATUS, FEASIBILITY_SCOPE, diagnosticNotes, PHASES, PHASE_TINT, fmt, fmtHa, fmtMin, fmtT, narrate, srcName, stateAt, drawAt, energyComparison, cycleEnergyText, feasibilityText, missionReady } from '../../sim/index.js?v=816a54f9';
import { ensureM3D, m3dAz, m3dDead, sizeAvatar, updateM3D, setCamera } from '../bridge/viz3d.js?v=816a54f9';
import { makeDualGauge, makeGauge, makePhaseDial } from '../cockpit/gauges.js?v=816a54f9';
import { shipViz } from '../cockpit/shipviz.js?v=816a54f9';
import { updateRoster } from '../cockpit/tables.js?v=816a54f9';
import { $, cycleBar, esc, kvRows } from '../dom.js?v=816a54f9';
import { guardNoteWords, modeWords, needsShip, nothingShown } from '../feeds.js?v=816a54f9';
import {figure,inactiveText} from "../served-ui.js?v=816a54f9";
import { S } from '../store.js?v=816a54f9';

/* A fire's outline is "current" only on the live feed; on a dated view it is the one in
 * that day's record. */
const polygonWords = () => S.daySource === "live" ? "current polygon" : "published polygon";

export let phaseDialObj = null, gWater = null, gLN2 = null, gAlt = null;

export let gGen = null, gStore = null, gGs = null, pwrMax = null, lastShipShown = "";

export let forceAcc = 9;

export function cockpitShip() {
  return S.sel && S.sel.type === "ship" && missionReady(S.sel.m) ? S.sel.m : null;
}

/* ---------- the one live region ------------------------------------------------------------- */

/* #liveNote in index.html is the only thing on this page that speaks unprompted.
 *
 * The operation strip used to be aria-live="polite" while being rebuilt whole on every
 * selection and rewritten every 1.5 seconds. That is not an announcement, it is a broadcast
 * nobody can stop, and it made the page unusable with a screen reader running. Instruments
 * that move continuously — the dials, the power bars, the forces, the narration — now carry
 * their readings on themselves, to be read when asked for. Only three things interrupt:
 * a change of selection, a phase change on the selected ship, and a change of data source.
 *
 * Repeats are dropped. renderDrawer() runs again on every fifteen-minute feed rebuild with
 * the same ship still selected, and hearing about that twice would teach a listener to
 * ignore the region entirely. */
let lastSaid = "";

export function announce(msg) {
  const el = $("liveNote");
  if (!el || !msg || msg === lastSaid) return;
  lastSaid = msg;
  el.textContent = msg;
}

/* What the current selection is, in one sentence. Returned rather than announced so the
   caller decides; renderDrawer is the only caller and it announces every time it runs. */
function selectionLine() {
  if (!S.sel || (!S.sel.m && !S.sel.f)) return "Selection cleared. Nothing is open.";
  if (S.sel.type === "ship" && S.sel.m && !S.sel.m.idle) {
    const m = S.sel.m;
    return `${m.name || m.cls.name}, ${m.cls.name}, serving ` +
      `${m.fire.name || m.fire.geo || m.fire.id}. Cockpit open.`;
  }
  if (S.sel.type === "fire") {
    const f = S.sel.f || (S.sel.m && S.sel.m.fire);
    return `Fire ${f.name || f.geo || f.id}: ${f.status}, ${fmtHa(f.sizeHa)}.`;
  }
  const w = S.sel.m && S.sel.m.water;
  return w ? `Water source ${w[4] || (w[3] ? "unnamed reservoir" : "unnamed lake")}, ` +
    `${fmt(w[2])} hectares, serving fire ${S.sel.m.fire.id}.` : "";
}

export function renderDrawer() {   // builds the cockpit skeleton for the current selection
  updateRoster();
  const ck = $("cockpit"), L = $("cpLeft"), R = $("cpRight"), O = $("cpOps");
  const m = cockpitShip();
  ck.classList.toggle("has-ship", !!m);
  L.hidden = !m; R.hidden = !m;
  O.hidden = false;
  phaseDialObj = null;
  if (S.sel?.m?.served && !missionReady(S.sel.m)) {
    O.innerHTML = `<p data-plan-inactive="${esc(S.sel.m.name)}">${esc(inactiveText(S.sel.m))}</p>`;
    noteSelection(); return;
  }
  if (!S.sel || (!S.sel.m && !S.sel.f)) {
    // On a record-only day there is no fleet to point at, so the empty state points at the
    // record instead, and carries the mode sentence rather than cockpit instructions.
    // An empty view has neither: it carries the mode sentence, which says why, and points
    // at the day control only when the control has dated days to offer.
    O.innerHTML = nothingShown()
      ? `<div class="empty" style="padding:var(--s3);color:var(--faint);font-size:var(--t-14);line-height:1.7">${esc(modeWords())}${S.dayList && S.dayList.length ? " The day control lists the days this repository holds." : ""}</div>`
      : S.recordOnly
      ? `<div class="empty" style="padding:var(--s3);color:var(--faint);font-size:var(--t-14);line-height:1.7">No fleet is simulated for this day. Click a <b style="color:var(--warm)">fire</b> for its published record — status, size, cause, perimeter — as British Columbia reported it.<br><br>${esc(modeWords())}</div>`
      : '<div class="empty" style="padding:var(--s3);color:var(--faint);font-size:var(--t-14);line-height:1.7">Nothing selected. Click a <b style="color:var(--warm)">ship</b> to open the cockpit — the airship and its forces on the left, the helm dials on the right, the operation down here — or click a fire or water source for its record.</div>';
    noteSelection();
    return;
  }
  const m3p = $("model3d");
  if (m3p && !m3dDead) {
    m3p.hidden = !m;
    if (m) {
      $("m3dTitle").textContent = (m.name ? m.name + " · " : "") + m.cls.name
        + (m.cls.id === "P100" ? "" : " · structural float unproven");
      ensureM3D(m);
    }
  }
  if (m) {
    const f = m.fire;
    // A NEW hull: snap the avatar's yaw and the 3D camera to its heading immediately —
    // the turn-rate caps exist for a ship turning, not for the user changing ships.
    if (m.shipId !== lastShipShown) {
      lastShipShown = m.shipId;
      shipViz.snap();
      setCamera({ azimuth: null });
    }
    $("cpShip").textContent = (m.name || m.cls.name) + " · " + m.cls.name
      + (m.cls.id === "P100" ? "" : " · structural float unproven") + " · " +
      (f.name || f.geo || f.id);
    phaseDialObj = makePhaseDial($("phaseDial"), m);
    const sd = $("sysDials");
    sd.innerHTML = "";
    // Row 1: motion. Row 2: mass aboard. Row 3: what is over the side — the two lines the ship
    // lowers into a lake, in metres — and what storage remains. The generation-against-
    // consumption face that used to sit here said nothing the bars beneath it do not say
    // better, while the anchor and the hose had no instrument at all.
    gGs = makeGauge(sd, "ground speed", Math.max(60, Math.round(m.cls.cruiseKph * 1.9)),
      v => fmt(v) + " km/h");
    gAlt = makeGauge(sd, "altitude", 1800, v => fmt(v) + " m");
    gWater = makeGauge(sd, "water aboard", m.cls.payloadT, v => fmtT(v));
    // Against TANK CAPACITY, with the plan's make-target as the tick: the plant never comes
    // close to filling the tanks on a short leg, and the dial should say so.
    gLN2 = makeGauge(sd, "LN₂ ballast", Math.max(1, m.cls.ln2CapT), v => fmtT(v),
      m.plan.ln2MakeT / Math.max(1, m.cls.ln2CapT));
    const solMW = m.cls.solarM2 * CFG.solarWPerM2 / 1e6;
    const regenPk = m.plan.eBack / Math.max(0.02, m.plan.dur.WATER_FILL / 60);
    const hotelMW = m.cls.genMW * 0.02;
    // Per-system CEILINGS: each bar reads utilization against what that system can give,
    // and the gen/use dial spans the worst realistic phase combination.
    pwrMax = {
      pwSol: Math.max(0.05, solMW),
      pwRgn: Math.max(0.05, regenPk),
      pwPrp: Math.max(0.1, m.plan.dragMW, m.plan.downMW, m.cls.battMW * 0.5),
      pwPmp: Math.max(0.1, m.plan.pumpMW * 1.06),
      pwCry: Math.max(0.1, m.cls.cryoMW * CFG.cryoMul),
      pwHot: Math.max(0.02, hotelMW),
    };
    const dialPk = Math.max(0.5, solMW + regenPk,
      m.plan.pumpMW + hotelMW,
      m.plan.dragMW + hotelMW,
      m.cls.cryoMW * CFG.cryoMul * m.mode.cryoShare + m.plan.dragMW + hotelMW,
      m.plan.downMW + m.plan.dragMW + hotelMW);
    /* WHAT IS HANGING UNDER THE SHIP, in metres, on one face.
     *
     * This was generation against consumption — a dial whose whole content is repeated
     * immediately below it as bars, with the gap between the needles saying "deficit" and the
     * bars saying it better. The two lines the ship lowers into a lake had no instrument at all,
     * which for a vehicle that gets down by putting a bucket in the water is the wrong way
     * round. Both against the longer of the two, so the cable and the hose read at one scale
     * and the reader can see the anchor go out long before the pumps do. */
    gGen = makeDualGauge(sd, "anchor cable", "intake hose",
      Math.max(1, m.cls.anchorM || 0, m.cls.hoseM), v => fmt(v), "m");
    gStore = makeGauge(sd, "storage", m.cls.battMWh, v => fmt(v, v < 10 ? 1 : 0) + " MWh");
    const barRow = ([lab, id, col]) =>
      `<div class="b-row"><span class="b-lab">${lab}</span>` +
      `<span class="b-tr"><span class="b-fill" id="${id}" style="width:0%;background:${col}"></span></span>` +
      `<span class="b-val" id="${id}v">–</span></div>`;
    /* The two headings take the DIAL'S colours — green for generation, warm for consumption —
     * because they label the same two quantities the dual gauge above them plots against each
     * other (gauges.js: #46d06e and #d98b80). Both were `--faint` grey, which left the reader
     * matching a heading to a needle by position alone. The bars beneath each heading are
     * already coloured per system; this makes the group they belong to legible at a glance. */
    const grpH = (t, col) => `<div style="font:600 var(--t-11)/1 var(--mono);letter-spacing:.14em;` +
      `text-transform:uppercase;color:${col};margin:2px 0 1px">${t}</div>`;
    $("pwrBars").innerHTML = '<div class="bars">' +
      grpH("generation", "#46d06e") +
      [["solar", "pwSol", "#46d06e"], ["N₂ regen", "pwRgn", "#46d06e"]].map(barRow).join("") +
      grpH("consumption", "#d98b80") +
      [["propulsion", "pwPrp", "#ff4fa3"], ["water sys", "pwPmp", "#7aa2c8"],
       ["ballast plant", "pwCry", "#b48ead"], ["baseline", "pwHot", "#74747f"]].map(barRow).join("") +
      '</div><div style="font:var(--t-11)/1.3 var(--mono);color:#3a3a42;margin-top:2px">each bar = share of that system\'s maximum</div>' +
      '<p class="cycnote" id="pwNet" style="margin-top:var(--s2);min-height:1.35em"></p>';
    $("cpStep").innerHTML = S.reduced
      ? '<button class="close" style="float:none;border:1px solid var(--line-strong);border-radius:999px;padding:5px 10px;background:none;color:var(--faint);cursor:pointer;font:600 var(--t-11) var(--mono)" onclick="APP.step(-1)">← phase</button> <button class="close" style="float:none;border:1px solid var(--line-strong);border-radius:999px;padding:5px 10px;background:none;color:var(--faint);cursor:pointer;font:600 var(--t-11) var(--mono)" onclick="APP.step(1)">phase →</button>'
      : "";
    requestAnimationFrame(sizeAvatar);
    O.innerHTML = `<p class="cycnote" data-plan-wind>Routes: ${m.plan.windUsed ? "wind-informed legs and selected vertical profile." : "wind not measured; still-air plan."}</p><div class="ops3">
      <div><h4>Operation · ${S.exercise ? "exercise · invented fire" : S.daySource === "live" ? "live incident" : "the record of " + esc(S.day)}</h4>` + kvRows([
        ["fire", esc(f.name || f.geo || f.id) + " <small>" + esc(f.id) + "</small>", "live"],
        ...(!S.exercise && f.geo ? [["record description", esc(f.geo), "live"]] : []),
        ["status", esc(f.status) + (f.note ? " · NOTE" : ""), "live"],
        ["reported size", fmtHa(f.sizeHa), "live"],
        ["perimeter", S.exercise ? (f.ring ? "generated exercise outline" : "invented point") : f.ring ? polygonWords() : "point only", "live"],
      ]) + (f.url ? `<p style="margin-top:var(--s2);font-size:var(--t-12)"><a href="${esc(f.url)}">Official incident page ↗</a> <span style="color:var(--faint)">· ${S.daySource === "live" ? "live data" : "the record as published"}; all else simulated</span></p>` : "") + `</div>
      <div><h4>Attack route · simulated</h4>` + kvRows([
        ["water source", esc(srcName(m)) + " <small>" + fmt(m.water[2]) + " ha</small>", "sim"],
        ["planned leg", m.legKm.toFixed(1) + " km · " + (m.stations ? m.stations.length : 1) + " hose stations", "sim"],
        ["release", m.targets.length + " planned lines" + (m.heat ? " on satellite heat" : "") +
          (m.refusedTargets?.length ? "; " + m.refusedTargets.length + " geometric targets refused: no tested line fits inside the modelled fire" : ""), "sim"],
        ["priority", m.whyT && m.order ? esc(m.whyT[m.order[0]]) : "—", "sim"],
        ["nearby community", m.protect ? esc(m.protect.name) + " — " + m.protect.dKm.toFixed(0) + " km" + (m.protect.dw ? ", downwind" : "") : "no listed community within 40 km", "sim"],
      ]) + `<details class="d" style="border:0;margin-top:var(--s2)"><summary style="padding:4px 0 4px 22px;font-size:var(--t-12);color:var(--faint)">why this tasking</summary>
        <div class="dbody" style="padding:0 0 var(--s2) 0"><p style="font-size:var(--t-11);color:var(--faint)">${esc(m.why)} ${esc(m.srcWhy)}</p></div></details></div>
      <div><h4>Cycle · simulated</h4><div id="opsCycle"></div></div>
      <div><h4>The Mind — running trace</h4><div class="narr" id="opsNarr"></div></div>
    </div>`;
    $("opsCycle").innerHTML = cycleBar(m, null) +
      `<p class="cycnote" id="opsNow"></p>` +
      `<p class="cycnote">${figure(m,"tph",m.plan.tph,fmt(m.plan.tph))} t/h to this fire · ${cycleEnergyText(energyComparison(m.cls,m.mode,m.legKm,m.wind,m.plan))}</p><p class="cycnote"><span data-planned-mode="${m.mode.id}">Planned ${esc(m.mode.label.toLowerCase())} mode</span> · water requested ${figure(m,"requestedT",m.cls.payloadT,fmtT(m.cls.payloadT))} · kept aboard ${figure(m,"retainedT",m.plan.retainedT,fmtT(m.plan.retainedT))} · delivered ${figure(m,"deliveredT",m.plan.deliveredT,fmtT(m.plan.deliveredT))} per cycle. Altitude, airspeed and phase times follow the selected plan; map tracks are schematic. No aircraft has flown.</p><p class="cycnote">${MODEL_STATUS} ${FEASIBILITY_SCOPE} ${diagnosticNotes(m.cls,m.legKm,m.selection,m.wind??null).join(". ")}</p>`;
    $("opsNarr").innerHTML = ["LAST", "NOW", "NEXT", "PLAN"].map((kk, i) =>
      `<div class="n-row"><span class="n-k${kk === "NOW" ? "" : " past"}">${kk}</span><p class="n-b" id="opsN${i}"></p></div>`).join("");
    $("cpForces").innerHTML = '<dl class="kv">' + [
      ["buoyancy", "fvB", "live"], ["ship overhead", "fvO", ""], ["water aboard", "fvP", "sim"],
      // The bucket sits with the forces because that is what it is — the largest single one on
      // the hull whenever it is in the water — and it is listed immediately above the net so a
      // reader can see the net change as it fills.
      ["descent anchor", "fvK", "sim"],
      ["net", "fvN", "sim"], ["altitude", "fvA", ""],
      ["wind @ 850 hPa", "fvWd", m.wind ? "live" : ""], ["ground speed", "fvG", "sim"],
      ["heading work", "fvH", ""],
    ].map(([lab, id, cl]) => `<dt>${lab}</dt><dd class="${cl}" id="${id}">–</dd>`).join("") + "</dl>";
  } else if (S.sel.type === "fire") {
    const f = S.sel.f || (S.sel.m && S.sel.m.fire), mm = S.sel.m;
    O.innerHTML = `<div class="ops3">
      <div><h4>${S.exercise ? "Exercise · invented fire" : (S.daySource === "live" ? "Live incident" : "Published record · " + esc(S.day)) + " · BC Wildfire Service"}</h4>` + kvRows([
        ["fire", esc(f.name || f.geo || f.id), "live"],
        ["number", esc(f.id), "live"],
        ...(!S.exercise && f.geo ? [["record description", esc(f.geo), "live"]] : []),
        ["status", esc(f.status) + (f.note ? " · wildfire of note" : ""), "live"],
        ["reported size", fmtHa(f.sizeHa), "live"],
        ["ignition", f.ignited ? f.ignited.toLocaleDateString("en-CA") : "—", "live"],
        ["cause", esc(f.cause || "—"), "live"],
        ["perimeter", S.exercise ? (f.ring ? "generated exercise outline" : "invented point") : f.ring ? polygonWords() + " shown" : "none published — point only", "live"],
      ]) + (f.url ? `<p style="margin-top:var(--s3);font-size:var(--t-12)"><a href="${esc(f.url)}">Official incident page ↗</a></p>` : "") + `</div>
      <div><h4 style="color:var(--warm)">Simulated response</h4>` +
      (S.recordOnly
        ? `<p style="font-size:var(--t-13);color:var(--muted)">None. No fleet is simulated for this day, so there is no simulated response to describe.</p>`
        : !mm ? (f.guarded
          // The guard's own reason, never an allocator's: on these fires the fleet was never
          // a candidate, and "queued" or "no ship" would say the opposite.
          ? `<p style="font-size:var(--t-13);color:var(--muted)">None. ${esc(guardNoteWords())}</p>`
          : f.heldOut
          ? `<p style="font-size:var(--t-13);color:var(--muted)">${esc(f.heldOut)}.</p>`
          : needsShip(f)
          ? `<p style="font-size:var(--t-13);color:var(--muted)">None: the allocator gave this fire no ship. The demonstration fleet is sixteen hulls (ten P-100, five P-1000, one P-10000), each sent to the fire it fits best, and the allocator counts every fire left without one. Any finite fleet faces the same arithmetic.</p>`
          : `<p style="font-size:var(--t-13);color:var(--muted)">None. This incident is ${esc(f.status.toLowerCase())}${S.exercise ? " in this exercise, so it is not a candidate for a simulated ship." : ", so it gets no allocation in the simulation."}</p>`)
        : mm.idle ? `<p style="font-size:var(--t-13);color:var(--muted)">${esc(mm.served ? inactiveText(mm) : mm.why)}</p>`
        : kvRows([
            ["assigned class", mm.cls.name, "sim"],
            ["water source", esc(srcName(mm)), "sim"],
            ["planned leg", mm.legKm.toFixed(1) + " km", "sim"],
            ["cycle", fmtMin(mm.plan.cycleMin), "sim"],
            ["per hour", fmt(mm.plan.tph) + " t <small>(" + fmt(mm.plan.tph * 1000) + " L)</small>", "sim"],
          ]) + `<p style="margin-top:var(--s3)"><button class="close" style="float:none;border:1px solid var(--line-strong);border-radius:999px;padding:6px 12px;background:none;color:var(--faint);cursor:pointer" onclick="APP.selShip()">Open the cockpit →</button></p>`) +
      (S.recordOnly ? "" :
      `<p style="margin-top:var(--s3);font-size:var(--t-11);color:var(--faint)">Nothing under “Simulated response” is an operational recommendation, and none of it says whether this fire grows or is contained. ${FEASIBILITY_SCOPE} ${mm&&!mm.idle?diagnosticNotes(mm.cls,mm.legKm,mm.selection,mm.wind??null).join(". "):""}</p>`) + `</div>
    </div>`;
  } else {
    const mm = S.sel.m, w = mm.water;
    O.innerHTML = `<div class="ops3">
      <div><h4>Mapped water body · Freshwater Atlas</h4>` + kvRows([
        ["name", esc(w[4] || (w[3] ? "Unnamed reservoir" : "Unnamed lake")), "live"],
        ["kind", w[3] ? "reservoir (definite)" : "lake (definite)", "live"],
        ["mapped surface", fmt(w[2]) + " ha", "live"],
      ]) + `</div>
      <div><h4 style="color:var(--warm)">Simulated draw</h4>` + kvRows([
        ["serving fire", esc(mm.fire.id), "sim"],
        ["assigned ship", mm.cls.name, "sim"],
        ["planned leg", mm.legKm.toFixed(1) + " km", "sim"],
        ["intake", "mid-lake, long-axis centerline", "sim"],
        ["draws per hour", mm.plan.dropsPerHour.toFixed(1) + " × " + fmtT(mm.plan.deliveredT) + " delivered; " + fmtT(mm.plan.retainedT) + " kept aboard", "sim"],
      ]) + `<p style="margin-top:var(--s3);font-size:var(--t-11);color:var(--faint)">${esc(mm.srcWhy)} Repeated withdrawal at this rate is not claimed to be sustainable. ${FEASIBILITY_SCOPE} ${diagnosticNotes(mm.cls,mm.legKm,mm.selection,mm.wind??null).join(". ")}</p></div>
    </div>`;
  }
  noteSelection();
  updateCockpitText();
  // A new cockpit must show its own power readings immediately, before the slow refresh tick.
  forceAcc = 9;
  updateCockpit();
}

/* Announce the selection, and swallow the phase announcement that would otherwise land on
   top of it: the sentence just spoken already named the ship, and its phase is on the dial. */
function noteSelection() {
  const m = cockpitShip();
  lastPhaseKey = m ? m.shipId + ":" + stateAt(m, S.simTime).phase : "";
  lastPhaseAt = Date.now();
  announce(selectionLine());
}
/* Per-frame instrument refresh: 3D ship, dial needles; throttled text. */

export function updateCockpit() {
  const m = cockpitShip();
  if (!m) return;
  const st = stateAt(m, S.simTime);
  shipViz.draw(st, m);
  updateM3D(m, st);
  if (phaseDialObj) phaseDialObj.set(st);
  const d = st.draw, g = st.gen || {};
  const prp = (d.prop || 0) + (d.rotors || 0);
  const pmp = (d.pumps || 0) + (d.winch || 0);
  const cry = d.cryo || 0, hot = d.hotel || 0;
  const sol = g.solar || 0, rgn = g.regen || 0;
  if (gWater) gWater.set(st.water, m.cls.payloadT);
  if (gLN2) gLN2.set(st.ln2, Math.max(1, m.cls.ln2CapT));
  // Metres of line out: the anchor's from the model, the hose's from the phase the monitor's
  // own six-phase cycle pays it out over (adapter/fable.js does the same sum for the 3D).
  if (gGen) {
    const hoseOut = st.phase === "SOURCE_APPROACH" ? st.prog
      : st.phase === "WATER_FILL" ? 1
        : st.phase === "OUTBOUND_TRANSIT" ? Math.max(0, 1 - st.prog / 0.18) : 0;
    gGen.set((st.anchorCableOut || 0) * (m.cls.anchorM || 0), hoseOut * m.cls.hoseM);
  }
  if (gStore) gStore.set(m.battE === undefined ? m.cls.battMWh : m.battE, m.cls.battMWh);
  if (gGs) gGs.set(st.gs || 0);
  if (gAlt) gAlt.set(st.alt);
  forceAcc += S.frameDt || 0.016;
  if (forceAcc > 0.35) {
    forceAcc = 0;
    // Each bar reads utilization against ITS OWN system's ceiling (set in renderDrawer);
    // the number beside it is the current draw.
    for (const [id, v] of [["pwSol", sol], ["pwRgn", rgn], ["pwPrp", prp],
                           ["pwPmp", pmp], ["pwCry", cry], ["pwHot", hot]]) {
      const bar = $(id), val = $(id + "v");
      const mx = (pwrMax && pwrMax[id]) || 1;
      if (bar) bar.style.width = Math.max(v > 0.005 ? 1.5 : 0, Math.min(100, v / mx * 100)) + "%";
      if (val) val.textContent = fmt(v, v < 10 ? 1 : 0) + " MW";
    }
    const netEl = $("pwNet");
    if (netEl) {
      const net = sol + rgn - (prp + pmp + cry + hot);
      netEl.innerHTML = st.stopped
        ? '<b style="color:var(--red)">power exhausted</b> · vertical motion after shutdown is not modelled'
        : `net <b style="color:${net < 0 ? "var(--red)" : "#46d06e"}">${net < 0 ? "−" : "+"}${fmt(Math.abs(net), 1)} MW</b>` +
          (net < 0 ? " — storage depleting, no refills yet" : " — storage recovering");
    }
    if (netEl) {
      const pair = energyComparison(m.cls,m.mode,m.legKm,m.wind,m.plan);
      const other = pair.favourable.feasible ? drawAt(m.cls,m.mode,pair.favourable,st.phase,st.prog) : null;
      const favourableNet = other ? Object.values(other.gen).reduce((a,b)=>a+b,0)-Object.values(other.draw).reduce((a,b)=>a+b,0) : null;
      netEl.innerHTML += ` · record: ${feasibilityText(pair.record)} · favourable: ${other ? fmt(favourableNet,1) + " MW net; " + feasibilityText(pair.favourable) : "net power unavailable: these controls do not close"}`;
    }
    const tf = 1000 * 9.81, put = (id, v) => { const el = $(id); if (el) el.innerHTML = v; };
    // ONE SIGN CONVENTION: down is positive. Buoyancy pulls up, so it is a negative number,
    // and the two things it has to carry — the ship itself and whatever water is aboard —
    // are positive. A net that stays negative is the honest headline: this hull is light
    // even when full, which is exactly why the rotors spend the cycle pushing it down.
    const overheadT = Math.max(0, st.massT - st.water);
    const payFrac = st.water / Math.max(1, m.cls.payloadT);
    put("fvB", "−" + fmt(st.buoyN / tf) + " t");
    put("fvO", fmt(overheadT) + " t <small>dry + LN₂</small>");
    put("fvP", fmt(st.water) + " t <small>" + (payFrac * 100).toFixed(0) + "% of water requested " +
      fmt(m.cls.payloadT) + " t</small>");
    // WEIGHT AND PULL. Tonnes of lake water in the bag, and what that is as a force on the
    // cable — 12,400 t is 122 MN, which is the number that sizes the rope.
    const anchorMN = (st.anchorN || 0) / 1e6;
    put("fvK", st.anchorT > 0.5
      ? fmt(st.anchorT) + " t <small>pulling " + anchorMN.toFixed(0) + " MN on "
        + fmt(Math.round((st.anchorCableOut || 0) * m.cls.anchorM)) + " m of cable</small>"
      : (m.cls.anchorM ? "stowed <small>" + fmt(m.cls.anchorBagT) + " t bag · "
        + fmt(m.cls.anchorM) + " m cable</small>" : "not fitted"));
    const nEl = $("fvN");
    if (nEl) {
      // The caption names WHAT is holding it down, because since the anchor exists that is no
      // longer always the rotors — and while the bag is in the water it is mostly not.
      const holder = st.anchorT > 0.5 ? "anchor + rotors hold it down" : "rotors hold it down";
      nEl.innerHTML = (st.netN > 0 ? "−" : "+") + fmt(Math.abs(st.netN) / tf) + " t <small>" +
        (st.netN > 0 ? "net lift — " + holder : "net weight") + "</small>";
      nEl.className = "sim";
    }
    put("fvA", fmt(st.alt) + " m <small>nominal</small>");
    put("fvWd", m.wind ? fmt(m.wind.spd) + " km/h from " + fmt(m.wind.dir) + "°" : "unavailable");
    put("fvG", m.plan.windUsed ? "out " + fmt(m.plan.gsOut) + " · back " + fmt(m.plan.gsRet) + " km/h" : fmt(m.plan.gsOut) + " km/h still air");
    put("fvH", st.phase === "WATER_FILL" ? "station-keeping — holds position exactly" : "en route");
  }
}
/* Slow text: narrative and the linear cycle bar in the operation panel. */

export function updateCockpitText() {
  const m = cockpitShip();
  if (!m) return;
  const st = stateAt(m, S.simTime);
  const n = narrate(m, st);
  document.querySelectorAll("#opsCycle .cycbar i").forEach((sg, i) =>
    sg.classList.toggle("on", i === st.idx));
  const now = $("opsNow");
  if (now) now.innerHTML = `now: <b style="color:${PHASE_TINT[st.phase]};font-weight:600">${PHASES[st.idx][1]}</b>`;
  [n.last, n.now, n.next, n.plan].forEach((t, i) => {
    const el = $("opsN" + i);
    if (el && el.textContent !== t) el.textContent = t;
  });
}
/* The two changes worth interrupting for, checked on the slow tick rather than per frame.
   Both are guarded so that a tick on which nothing changed says nothing at all. */
let lastPhaseKey = "", lastPhaseAt = 0, lastSrcKey = "";

function noteChanges() {
  const m = cockpitShip();
  if (m) {
    const st = stateAt(m, S.simTime);
    const key = m.shipId + ":" + st.phase;
    const now = Date.now();
    // At 60× a phase can turn over every few seconds, and six phases per cycle of speech is
    // the storm this replaced. A phase is announced at most once every five REAL seconds;
    // when one is skipped the next tick announces whatever phase is current by then, and the
    // dial holds the exact answer for anyone who asks.
    if (key !== lastPhaseKey && now - lastPhaseAt > 5000) {
      lastPhaseKey = key; lastPhaseAt = now;
      announce(`${m.name || m.cls.name}: ${PHASES[st.idx][1]}.`);
    }
  }
  // Which feed the fires came from. This flips at most once per fifteen-minute refetch, and
  // usually never — but it changes what the whole page means, so it is worth saying. A
  // dated view is never announced as a snapshot that "could not be reached": the visitor
  // asked for that day, or the day was named in the link they followed.
  const srcKey = S.fetchedAt ? S.daySource + ":" + (S.day || "") + ":" + S.fires.length : "";
  if (srcKey && srcKey !== lastSrcKey) {
    const first = lastSrcKey === "";
    lastSrcKey = srcKey;
    announce(S.daySource === "live"
      ? `Fire data: live BC Wildfire Service feed, ${S.fires.length} fires${first ? "" : " — refreshed"}.`
      : S.fires.length
      ? `Fire data: the record of ${S.day || (S.snapshotDate || "").slice(0, 10)}, ${S.fires.length} fires as published.`
      : `Fire data: nothing is shown for ${S.unknownDay || S.day || "this view"}.`);
  }
}

setInterval(() => {
  if (!S.paused && cockpitShip() && !document.hidden) updateCockpitText();
  if (!document.hidden) noteChanges();
  // Late-arriving text (pwNet and friends) can nudge the right column past its box after
  // sizeAvatar already measured; the column must never scroll, so re-check on this cadence.
  const col = document.querySelector(".cp-rightcol");
  if (col && !$("cpLeft").hidden && col.scrollHeight > col.clientHeight) requestAnimationFrame(sizeAvatar);
}, 1500);

export function timeSinceDrop(m) {
  if (m.idle) return null;
  const t = ((S.simTime + m.offset * m.cycleSec) % m.cycleSec + m.cycleSec) % m.cycleSec;
  const relEnd = m.phaseEnds[3];
  const cycN = Math.floor((S.simTime + m.offset * m.cycleSec) / m.cycleSec) + 1;
  if (t >= relEnd) return t - relEnd;
  if (cycN > 1) return t + (m.cycleSec - relEnd);
  return null;                                       // first cycle, nothing dropped yet
}
