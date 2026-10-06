/* Qualification of the unchanged quasi-static force-and-bus predicate. */
export const MISSION_QUALIFIER = 'These plans close only in the quasi-static force-and-bus model. Vertical dynamics, suspended-load control and sufficient stored energy for mission completion remain unestablished.';
export const FEASIBILITY_SCOPE = 'Feasible means quasi-static force and bus closure at every checked instant. Battery hours are reported; they do not determine feasibility. ' + MISSION_QUALIFIER;
export const MODEL_STATUS = 'These are feasible simulated plans, conditional on the model assumptions. Structural float and flight performance remain unproven. No aircraft has flown.';
export const DYNAMIC_PROFILE_NOTE = 'quasi-static closure; dynamic profile unresolved';
export const STORAGE_PROFILE_NOTE = 'quasi-static closure; exceeds nominal storage in one ideal cycle';
