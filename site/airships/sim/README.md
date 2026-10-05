<!-- energy:simulator:start -->
# The simulator and its energy ledger

The modules in this directory have no DOM or network dependency. Class dimensions and power ratings are assumptions, not measured aircraft data.

## Run a cycle

Import `CLASSES`, `MODES` and `planCycle` from `sim/index.js` in Node. Pass a one-way distance in kilometres and an optional wind record.
The fifth argument selects basis, retained water and profile controls. Record basis is the default. Always read `feasible`, `worst` and `bindingLimits` beside energy and delivery.

| Module | Owns |
|---|---|
| config.js | Class constants, operating modes and declared assumptions |
| atmosphere.js | Local ISA density |
| physics.js | Lift, drag, pumping and actuator-disk equations |
| power.js | Instantaneous force owners, prices, bus and energy integral |
| profile.js | Independent vertical controls and segment distance |
| plan.js | Cycle timetable and integrated ledger |
| requirements.js | Replayed requirements and finite profile search |
| state.js | State and telemetry for a prescribed mission |
| energy-view.js | Paired basis readings for existing page binders |
| mission.js | Mission construction |
| assign.js / water.js / targets.js | Allocation, sources and drop lines |
| geo.js / rng.js / format.js | Geometry, repeatable randomness and presentation |
| selftest.js / index.js | Checks and public exports |

| Class | Hull m | Design volume m³ | Battery MWh / MW | Generator MW |
|---|---|---|---|---|
| P100 | 110 × 55 | 220000 | 20 / 30 | 8 |
| P1000 | 238 × 119 | 2200000 | 120 / 150 | 40 |
| P10000 | 512 × 256 | 22000000 | 2000 / 1400 | 150 |

## Force and energy rules

The ledger subtracts all onboard weight from local buoyant lift.
Its owners are the cable-carried water, downward rotors, permitted aerodynamic downforce and signed vertical drag.
Unheld force stays visible.

Surplus is local displaced-air mass minus dry mass, water and nitrogen.
The signed residual is surplus minus bag support, rotor thrust, aerodynamic downforce and vertical drag.

Glauert momentum pricing solves T = 2 ρ A v_i √(V² + (v_c + v_i)²), then P = T (v_c + v_i) / η.
The vertical drag owner is ρ C_D S v_z |v_z| / (2 g), with upward velocity positive.
The favourable downforce cap is C_L,max q S, and its induced drag is T_aero² / (q π b² e).

The force tolerance is 0.000001 times the larger of unity and absolute surplus.
Constraint sampling uses 1024 intervals per phase, plus seams and internal profile joins.
Energy uses 96 midpoint intervals per phase; constraint peaks are checked separately.

The unverified broadside coefficient is 1; the favourable lift coefficient is 1.
The reported lift-coefficient sweep is 0.5, 1, 1.5; rotor-efficiency endpoints are 0.55, 0.7.
Bag water is credited when carried; its 15 m lift at efficiency 0.85 remains priced.

A cycle closes only when the residual and gross bus draw meet the stated tolerances at every checked instant.
Bus saturation alone is a note.
The rotors have no upward authority.

Record basis credits no aerodynamic hold-down.
Favourable basis chooses the least-power split between capped rotors and capped aerodynamic downforce.
Induced drag is charged to propulsion, and all force and power terms use local ISA density.

Rotor efficiency represents figure of merit times drive efficiency.
Hold-down descent is priced as climb, on the conservative side; climb against hold-down thrust is priced as level flight, with no bound claimed.

The installed thrust cap is an unverified hover surrogate at the battery-plus-generator rating.
A feasible result is quasi-static.
Feasible means quasi-static force and bus closure at every checked instant. Battery hours are reported; they do not determine feasibility.
The served-candidate inertia diagnostic (`research/analysis/energy-served-inertia.json` and `.mjs` in the repository) compares omitted vertical hull inertia and added mass with simultaneous rotor reserve at published and captured routes.
The feasible-profile records also contain that comparison for every phase.

## What the profile search means

The prescribed profile is retained as "as drawn".
The result is the cheapest feasible profile found in the stated space, not a global optimum.

Cruise speed multipliers: 0.5, 0.75, 1, 1.25, 1.5.
Modes: rapid, balanced, endurance.

| Independent parameter | Searched values |
|---|---|
| climbRateMps | 0.5, 2 |
| letdownRateMps | 0.5, 2 |
| climbAirspeedMps | 0, 5 |
| letdownAirspeedMps | 0, 5 |

Climb and letdown each have independent peak-rate and peak-airspeed caps.
The slowest peak letdown cap is 0.5 m/s on each class.
This finite bound includes slow descents; smaller caps remain unsearched, not physically excluded.

Short joins take longer when needed for smoothness.
The prescribed return widens its climb and letdown joins using an upper bound on the composed easing derivatives, so each of the 2,001 sampled vertical speeds differs by at most 0.1 m/s. If those joins would overlap, its return time grows instead. This applies to all searched prescribed controls, not one retained-water row.
The drop altitude, terrain clearance and cable reach stay fixed.
The approach remains stationary.
Segment time and ground distance are integrated; energy uses the same instantaneous ledger.
A profile exceeding the route distance is refused.

Retained water is searched at five-percent payload steps and at each bisected first closing threshold.
Printed requirements round upward at the verdict resolution and replay through the model.
The older whole-phase dilation is named `movingPhaseRateMultiplier`; the new search does not use it.

## Reading the output

`eCycleMWh` is gross integrated draw minus nitrogen recovery. Solar is reported separately.
`deliveredT`, `retainedT` and `cycleMin` describe the requested cycle. They establish delivery only when the force and bus verdict closes.
`E` contains phase integrals; `Echan` contains gross channel integrals. `drawAt` is the one source used by the telemetry adapters.
The detailed generated tables are in `research/analysis/energy-*.json`. Run `make energycheck energydoccheck` to replay their claims.
No aircraft has flown. The fleet remains simulated.
<!-- energy:simulator:end -->
