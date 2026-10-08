/* Straight-route track kinematics, separate from force-and-bus feasibility.
 * Boundary cases use stipulated test inputs, never incident operating limits. */
export function trackWind(selectedAirKph, wind = null) {
  if (!(Number.isFinite(selectedAirKph) && selectedAirKph > 0))
    throw new RangeError('Selected airspeed must be positive and finite');
  // Without a route bearing the vector cannot be projected onto a track.
  const windUsed = wind != null && wind.bearing != null;
  if (windUsed && !(Number.isFinite(wind.spd) && wind.spd >= 0 &&
                   Number.isFinite(wind.dir) && Number.isFinite(wind.bearing)))
    throw new RangeError('Route wind requires finite speed, direction and bearing');
  const angle = windUsed ? ((wind.dir + 180) % 360 - wind.bearing) * Math.PI / 180 : 0;
  const tailOut = windUsed ? wind.spd * Math.cos(angle) : 0;
  const crossOut = windUsed ? wind.spd * Math.sin(angle) : 0;
  const crossImpossible = Math.abs(crossOut) >= selectedAirKph;
  const alongAirKph = crossImpossible ? null : Math.sqrt(selectedAirKph ** 2 - crossOut ** 2);
  const gsOut = crossImpossible ? null : alongAirKph + tailOut;
  const gsRet = crossImpossible ? null : alongAirKph - tailOut;
  const trackReason = crossImpossible ? 'crosswind equals or exceeds selected airspeed'
    : !(gsOut > 0) ? 'outbound leg has no positive ground speed at selected airspeed'
    : !(gsRet > 0) ? 'return leg has no positive ground speed at selected airspeed'
    // Both leg speeds can be positive only when the wind magnitude is below V.
    // This equivalent condition prevents round-off at exact equality from inventing progress.
    : windUsed && wind.spd >= selectedAirKph
      ? 'wind magnitude reaches selected airspeed; round-trip progress is not positive' : null;
  return {selectedAirKph, alongAirKph, gsOut, gsRet, tailOut, crossOut, windUsed, trackPossible: trackReason === null, trackReason};
}

/** Point-of-rate boundary shared by the cockpit, tables and printed plan view. */
export function windBasis(plan) {
  return plan?.windUsed
    ? 'Wind basis: one pressure-level wind vector per route; straight level legs; no shear, turns, gusts or vertical air motion.'
    : 'Wind not measured; still-air plan.';
}
