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
| operating-margin.js | Control target, serving floor and local resource headroom |
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

Rotor efficiency represents figure of merit times drive efficiency, applied at every thrust and speed. There is no separate blade profile power or specified blade, rotor-speed or pitch policy; all rotor-energy figures are conditional on this scope. The generated separated-power comparison moves profile energy in both directions and is neither a bound nor a design.
<!-- rotor:area:start -->

### Rotor area convention

The drawing sums both blade disks at every coaxial station, approximately matching diskM2. A pair shares one stream, so its aerodynamic area is nearer one projected footprint; pricing treats its disks as independent. Footprints sum station areas without assigning additional inter-station overlap.

Sensitivity at selected profiles’ fixed controls; no re-search, design change or aircraft result. Failed-row MWh is clipped supplied effort, not completion energy.

| Class | Priced independent area m² | Drawn summed blade area m² | Projected footprint m² | Hover cap: priced / footprint tf | Same-thrust hover power: footprint / priced |
|---|---|---|---|---|---|
| P100 | 2500.000 | 2513.274 | 1256.637 | 153.059 / 121.697 | 1.410474 |
| P1000 | 12000.000 | 12214.512 | 6107.256 | 754.950 / 602.754 | 1.401740 |
| P10000 | 160000.000 | 158886.048 | 79443.024 | 7254.655 / 5744.629 | 1.419162 |

Hover caps use local density at the model’s working altitude and the unchanged efficiency and bus rating. The last column changes area only, at the same thrust and efficiency.

Stipulated sensitivity input: the reviewer’s favourable coaxial credit 0.90, from [Johnson’s NDARC theory](https://rotorcraft.arc.nasa.gov/ndarc/media/Files/reportsAndPapers/NDARC-NASA-TP-2009-215402.pdf), section 11-5.1.3, printed page 101. It is not a measured property of these rotors. Plan once with the original class and selected controls, then integrate that plan with footprint area. The stipulated credit is encoded as footprint area divided by credit squared; this is a hover-equivalent extension to the existing inflow law, not a validated coaxial envelope.

| Fixed selected profile | Priced area: closes / MWh | Footprint: closes / supplied MWh / unheld tf | Footprint with stipulated credit: closes / supplied MWh / unheld tf |
|---|---|---|---|
| P100 / 15.000 km / record / selected | yes / 6.622 | no / 9.310 / 13.686 | no / 8.446 / 7.004 |
| P100 / 15.000 km / favourable / selected | yes / 4.843 | yes / 6.023 / 0.000 | yes / 5.640 / 0.000 |
| P100 / 60.000 km / record / selected | yes / 12.706 | no / 16.918 / 16.814 | no / 15.495 / 9.325 |
| P100 / 60.000 km / favourable / selected | yes / 10.035 | no / 11.683 / 16.987 | no / 11.200 / 9.423 |
| P1000 / 15.000 km / record / selected | yes / 24.472 | no / 33.408 / 59.337 | no / 30.213 / 29.128 |
| P1000 / 15.000 km / favourable / selected | yes / 19.815 | no / 23.662 / 59.337 | no / 22.419 / 29.128 |
| P1000 / 60.000 km / record / selected | yes / 65.351 | no / 86.824 / 63.363 | no / 79.010 / 31.291 |
| P1000 / 60.000 km / favourable / selected | yes / 54.099 | no / 61.253 / 63.363 | no / 58.998 / 31.291 |
| P10000 / 15.000 km / record / selected | yes / 202.102 | no / 287.906 / 609.402 | no / 259.545 / 312.007 |
| P10000 / 15.000 km / favourable / selected | yes / 184.209 | no / 242.672 / 609.402 | no / 224.701 / 312.007 |
| P10000 / 60.000 km / record / selected | yes / 402.745 | no / 548.412 / 612.979 | no / 497.715 / 314.004 |
| P10000 / 60.000 km / favourable / selected | yes / 368.571 | no / 485.575 / 614.170 | no / 448.371 / 314.670 |

Failed-row supplied MWh is clipped effort and cannot be used as energy required to complete a mission. A failed fixed-control replay does not exclude a different closing plan. No geometry, diskM2, efficiency or selected controls change.

<!-- rotor:area:end -->

Hold-down descent is priced as climb, on the conservative side; climb against hold-down thrust is priced as level flight, with no bound claimed. Momentum theory covers normal-working and windmill-brake states but not the recirculating states between them. This model implements neither the windmill-brake branch nor a model for the intermediate states; no regenerative power is credited. 7 of 12 selected profiles cross the empirical isolated-rotor vortex-ring screen, including P100 / 15.000 km / record / selected: 0.743370 sampled minutes (water release 0.130370; buoyancy escape 0.613000), P100 / 15.000 km / favourable / selected: 0.865815 sampled minutes (water release 0.158815; buoyancy escape 0.707000), P100 / 60.000 km / record / selected: 0.387052 sampled minutes (water release 0.044652; buoyancy escape 0.342400), P100 / 60.000 km / favourable / selected: 0.438474 sampled minutes (water release 0.056073; buoyancy escape 0.382400), P1000 / 15.000 km / favourable / selected: 0.075758 sampled minutes (water release 0.075758), P10000 / 60.000 km / record / selected: 0.278400 sampled minutes (buoyancy escape 0.278400), P10000 / 60.000 km / favourable / selected: 0.368000 sampled minutes (buoyancy escape 0.368000). The generated phase table in the selected-profile analysis identifies the crossings. Empirical screen on isolated-rotor data at selected profiles’ fixed controls, with no re-search. It marks an unresolved state, not measured instability of an unbuilt hull; it does not make quasi-static closure false. Power while rising is priced as level flight with no bound. No replacement power, thrust or efficiency penalty is assigned.

The installed thrust cap is an unverified hover surrogate at the battery-plus-generator rating.
A feasible result is quasi-static.
Feasible means quasi-static force and bus closure at every checked instant. Battery hours are reported; they do not determine feasibility. These plans close only in the quasi-static force-and-bus model. Vertical dynamics, suspended-load control and sufficient stored energy for mission completion remain unestablished. Rotor energy and power figures are conditional on a constant hover merit times drive efficiency at every thrust and speed, with no separate blade profile power and no specified blade, rotor-speed or pitch policy. A separated model can move these figures in either direction.
The served-candidate inertia diagnostic (`research/analysis/energy-served-inertia.json` and `.mjs` in the repository) checks signed vertical hull demand against rotor authority in both directions at published and captured routes.
The feasible-profile records also contain that comparison for every phase.

## What the profile search means

The prescribed profile is retained as "as drawn".
The result is the cheapest reserve-eligible profile found in the stated space, not a global optimum.

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

Retained water is searched at five-percent payload steps and at each bisected first reserve-closing threshold.

Served controls target 10% relative reserve in the profile search and exact-route selection; serving requires at least 5%. The selector first prefers controls meeting the target at this route, then minimizes kWh per delivered tonne within that tier. If none meets the target, it may use a minimum-reserve control; it never serves below the minimum. Both tiers also require unchanged physical closure. Reserve is (capacity minus demand) / capacity for unclipped bus demand, local rotor thrust and combined downward authority. Upward thrust is absent: its reserve is (surplus lift minus signed vertical drag) / max(1 tonne, absolute surplus lift). Each minimum is checked on the same seam-inclusive limit mesh and refined extrema as physical closure. Cable reach and pickup, aerodynamic credit and route geometry retain their exact rules: unavailable support earns no credit; the downward-authority reserve uses only support actually carried. Force residual is a numerical closure tolerance, not spare hardware. Battery energy, transient control, structure and weather uncertainty are outside this reserve policy. The 5% power convention follows [GSFC-STD-1000H, Table 1.06-1, page 12](https://standards.nasa.gov/sites/default/files/standards/GSFC/H/0/GSFC-STD-1000RevH_Approved.pdf); its extension to force and the 10% control target are this simulation's conservative selection choices, not spacecraft-standard compliance or a validated uncertainty allowance. The search target leaves room above the serving cutoff when recorded controls are replayed at other route distances.
Printed requirements round upward at the verdict resolution and replay through the model.
The older whole-phase dilation is named `movingPhaseRateMultiplier`; the new search does not use it.

## Reading the output

These plans close only in the quasi-static force-and-bus model. Vertical dynamics, suspended-load control and sufficient stored energy for mission completion remain unestablished. Rotor energy and power figures are conditional on a constant hover merit times drive efficiency at every thrust and speed, with no separate blade profile power and no specified blade, rotor-speed or pitch policy. A separated model can move these figures in either direction.

`eCycleMWh` is gross integrated draw minus nitrogen recovery. Solar is reported separately.
`deliveredT`, `retainedT` and `cycleMin` describe the requested cycle in the quasi-static force-and-bus model; they do not establish mission completion.
`E` contains phase integrals; `Echan` contains gross channel integrals. `drawAt` is the one source used by the telemetry adapters.
The detailed generated tables are in `research/analysis/energy-*.json`. Run `make energycheck energydoccheck` to replay their claims.
No aircraft has flown. The fleet remains simulated.
<!-- energy:simulator:end -->
