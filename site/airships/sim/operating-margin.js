/* Selection policy, not a physical limit or a validated uncertainty bound.
 * Controls target 10% spare capacity; exact-route serving requires at least 5%.
 * See the generated served-plan documentation for the convention and its scope. */
export const SERVED_RELATIVE_MARGIN = 0.05;
export const CONTROL_RELATIVE_MARGIN = 0.10;
export const OPERATING_MARGIN_LIMITS = ['bus power','rotor thrust','downward authority','upward authority'];
export function operatingMarginRatio(s,k){
  if(k==='bus power')return (s.busMW-s.nonRotorMW-s.forceAskMW)/s.busMW;
  if(k==='rotor thrust')return (s.thrustLimitT-s.owners.rotorT)/s.thrustLimitT;
  if(k==='downward authority')return (s.thrustLimitT+s.aeroLimitT-Math.max(0,s.surplusT-s.owners.bagT-s.owners.verticalDragT))/(s.thrustLimitT+s.aeroLimitT);
  return (s.surplusT-s.owners.verticalDragT)/Math.max(1,Math.abs(s.surplusT));
}
export function instantOperatingMargins(s) {
  const down=Math.max(0,s.surplusT-s.owners.bagT-s.owners.verticalDragT);
  const values={
    'bus power': [s.nonRotorMW+s.forceAskMW,s.busMW,s.busMW],
    'rotor thrust': [s.owners.rotorT,s.thrustLimitT,s.thrustLimitT],
    'downward authority': [down,s.thrustLimitT+s.aeroLimitT,s.thrustLimitT+s.aeroLimitT],
    // Upward thrust is absent. Require positive natural lift after vertical drag;
    // normalize by the larger of one tonne and absolute surplus, not a zero cap.
    'upward authority': [s.owners.verticalDragT-s.surplusT,0,Math.max(1,Math.abs(s.surplusT))],
  };
  return Object.fromEntries(Object.entries(values).map(([k,[value,capacity,scale]])=>
    [k,{value,capacity,scale,relativeMargin:(capacity-value)/scale}]));
}
export function hasOperatingMargin(plan,minimum=SERVED_RELATIVE_MARGIN) {
  return !!(plan?.feasible&&Number.isFinite(minimum)&&minimum>=0&&minimum<1&&
    OPERATING_MARGIN_LIMITS.every(k=>Number.isFinite(plan.operatingMargins?.[k]?.relativeMargin)&&
      plan.operatingMargins[k].relativeMargin>=minimum));
}

export const OPERATING_MARGIN_TEXT = `Served controls target ${100*CONTROL_RELATIVE_MARGIN}% relative reserve in the profile search and exact-route selection; serving requires at least ${100*SERVED_RELATIVE_MARGIN}%. The selector first prefers controls meeting the target at this route, then minimizes kWh per delivered tonne within that tier. If none meets the target, it may use a minimum-reserve control; it never serves below the minimum. Both tiers also require unchanged physical closure. Reserve is (capacity minus demand) / capacity for unclipped bus demand, local rotor thrust and combined downward authority. Upward thrust is absent: its reserve is (surplus lift minus signed vertical drag) / max(1 tonne, absolute surplus lift). Each minimum is checked on the same seam-inclusive limit mesh and refined extrema as physical closure. Cable reach and pickup, aerodynamic credit and route geometry retain their exact rules: unavailable support earns no credit; the downward-authority reserve uses only support actually carried. Force residual is a numerical closure tolerance, not spare hardware. Battery energy, transient control, structure and weather uncertainty are outside this reserve policy. The 5% power convention follows [GSFC-STD-1000H, Table 1.06-1, page 12](https://standards.nasa.gov/sites/default/files/standards/GSFC/H/0/GSFC-STD-1000RevH_Approved.pdf); its extension to force and the 10% control target are this simulation's conservative selection choices, not spacecraft-standard compliance or a validated uncertainty allowance. The search target leaves room above the serving cutoff when recorded controls are replayed at other route distances.`;
