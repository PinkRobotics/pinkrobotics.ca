/* Requirements on existing hardware and profiles. All printed closing values are replayed. */
import {VERTICAL_PROFILE_GRID,verticalProfiles} from './profile.js?v=01e992e3';
import {CFG,MODES} from './config.js?v=01e992e3';
import {planCycle} from './plan.js?v=01e992e3';
import {hasOperatingMargin,CONTROL_RELATIVE_MARGIN,SERVED_RELATIVE_MARGIN} from './operating-margin.js?v=01e992e3';
import {drawAt,AERO_CL_VALUES,LIMIT_STEPS} from './power.js?v=01e992e3';
export const REQUIREMENT_DIGITS=3;
export const REQUIREMENT_UNIT=10**-REQUIREMENT_DIGITS;
export const roundRequirement=x=>Math.ceil(x/REQUIREMENT_UNIT)*REQUIREMENT_UNIT;
export function energySummary(cls,plan) {
  const deficit=plan.eCycleMWh-cls.solarM2*CFG.solarWPerM2/1e6*plan.cycleMin/60;
  return {basis:plan.basis,feasible:plan.feasible,bindingLimits:plan.bindingLimits,worst:plan.worst,
    cycleMWh:plan.eCycleMWh,kwhPerTonne:plan.deliveredT>0?plan.kwhPerTonne:null,cycleMin:plan.cycleMin,
    peakRotorMW:plan.downMW,hoursOnBattery:deficit>0?cls.battMWh/deficit*plan.cycleMin/60:null,
    deliveredT:plan.deliveredT,ballastT:plan.retainedT,
    energyMeaning:plan.feasible?'modelled cycle':'does not close on the drawn hardware; supplied effort only'};
}
function bisect(lo,hi,accept){
  // Find a replayable decimal first, then locate its threshold within the preceding unit.
  // Continuous extrema refinement can move a borderline verdict by a few microtonnes.
  const value=i=>+(i*REQUIREMENT_UNIT).toFixed(REQUIREMENT_DIGITS);
  let lower=Math.floor(lo/REQUIREMENT_UNIT),upper=Math.ceil(hi/REQUIREMENT_UNIT);
  if(!accept(value(upper)))throw new Error('requirement bracket has no feasible printed upper endpoint');
  while(upper-lower>1){const mid=Math.floor((lower+upper)/2);if(accept(value(mid)))upper=mid;else lower=mid;}
  const printed=value(upper);lo=value(lower);hi=printed;
  while(hi-lo>REQUIREMENT_UNIT/1024){const x=(lo+hi)/2;if(accept(x))hi=x;else lo=x;}
  return {lastInfeasible:lo,threshold:hi,printed,limitSteps:LIMIT_STEPS};
}
export function ballastRequirement(cls,mode,km,options={},spacing=.01,rejectEarly=false,onPlan=()=>{},acceptPlan=p=>p.feasible,earlyMinimum=0){
  const run=ballastT=>{onPlan();return planCycle(cls,mode,km,null,{...options,ballastT},rejectEarly&&earlyMinimum?{minimumOperatingMargin:earlyMinimum}:rejectEarly);};
  const base=run(0);
  if(acceptPlan(base))return {...energySummary(cls,base),threshold:0,lastInfeasible:null,limitSteps:LIMIT_STEPS};
  if(!base.dur)onPlan();
  const loaded=base.dur?base:planCycle(cls,mode,km,null,options);
  for(let i=0;i<=LIMIT_STEPS;i++){
    const s=drawAt(cls,mode,loaded,'OUTBOUND_TRANSIT',i/LIMIT_STEPS);
    if(s.unheldT< -1e-6*Math.max(1,Math.abs(s.surplusT)))return {feasible:false,reason:'loaded climb requires upward authority',invariantFailure:{phase:'OUTBOUND_TRANSIT',progress:i/LIMIT_STEPS,unheldT:s.unheldT}};
  }
  let lo=0;
  for(let i=1;i<=Math.round(1/spacing);i++){
    const hi=Math.min(cls.payloadT,cls.payloadT*i*spacing);
    if(acceptPlan(run(hi))){
      const bracket=bisect(lo,hi,x=>acceptPlan(run(x))),p=run(bracket.printed);
      if(!acceptPlan(p))throw new Error('rounded ballast failed replay '+JSON.stringify({class:cls.id,mode:mode.id,km,options,bracket,worst:p.worst}));
      return {...energySummary(cls,p),...bracket,search:`first feasible bracket at ${spacing*100}% payload spacing; same-resolution bisection and upward rounding`};
    }
    lo=hi;
  }
  return {feasible:false,reason:'none in the stated ballast grid; no proof of impossibility'};
}
export function closureRequirements(cls,mode,km,basis,options={}){
  const o={...options,basis},base=planCycle(cls,mode,km,null,o),ballast=ballastRequirement(cls,mode,km,o);
  const ample=planCycle(cls,mode,km,null,{...o,requiredBatteryMW:1e9,requiredRotorT:1e9});
  let powerAndThrust={feasible:false,reason:'downward thrust cannot close this prescribed path',verification:energySummary(cls,ample)};
  if(ample.feasible){
    const rotorCeiling=roundRequirement(ample.peakRotorT*(1+1e-9));
    const battery=bisect(0,roundRequirement(ample.peakBatteryMW*(1+1e-9)),x=>planCycle(cls,mode,km,null,{...o,requiredBatteryMW:x,requiredRotorT:rotorCeiling}).feasible);
    const rotor=bisect(0,rotorCeiling,x=>planCycle(cls,mode,km,null,{...o,requiredBatteryMW:battery.printed,requiredRotorT:x}).feasible);
    const trial=planCycle(cls,mode,km,null,{...o,requiredBatteryMW:battery.printed,requiredRotorT:rotor.printed});
    if(!trial.feasible)throw new Error('printed battery/thrust pair failed replay');
    powerAndThrust={requiredBatteryMW:battery.printed,requiredRotorT:rotor.printed,feasible:true,batterySearch:battery,rotorSearch:rotor,
      verification:energySummary(cls,trial),meaning:'what the model would require; conditional thresholds at the verdict resolution, rounded up and replayed'};
  }
  return {class:cls.id,km,basis,baseline:energySummary(cls,base),ballast,powerAndThrust,
    clSensitivity:AERO_CL_VALUES.map(clMax=>({clMax,...energySummary(cls,planCycle(cls,mode,km,null,{...o,clMax}))})),
    dragSensitivity:[0,1,2].map(verticalCd=>({verticalCd,...energySummary(cls,planCycle(cls,mode,km,null,{...o,verticalCd}))})),
    airBallast:'Unavailable: research/analysis/air-ballast.md retracts air admission into permanently sealed cells.'};
}
export const PROFILE_SEARCH={operatingMargin:{controlTarget:CONTROL_RELATIVE_MARGIN,servedMinimum:SERVED_RELATIVE_MARGIN},speedMultipliers:[.5,.75,1,1.25,1.5],verticalProfile:VERTICAL_PROFILE_GRID,modes:['rapid','balanced','endurance'],ballastFractions:Array.from({length:20},(_,i)=>i/20)};
export function cheapestFeasible(cls,km,basis,minimum=CONTROL_RELATIVE_MARGIN){
  let best=null,fullDeliveryBest=null,checked=0,planCalls=0;
  const consider=(mode,options)=>{
    const p=planCycle(cls,mode,km,null,options,{minimumOperatingMargin:minimum});checked++;planCalls++;
    if(!hasOperatingMargin(p,minimum)||!(p.deliveredT>0))return;
    const row={class:cls.id,km,basis,mode:mode.id,options,...energySummary(cls,p),operatingMargins:p.operatingMargins};
    if(!best||p.kwhPerTonne<best.kwhPerTonne)best=row;
    if(p.retainedT===0&&(!fullDeliveryBest||p.kwhPerTonne<fullDeliveryBest.kwhPerTonne))fullDeliveryBest=row;
  };
  for(const name of PROFILE_SEARCH.modes)for(const speedMultiplier of PROFILE_SEARCH.speedMultipliers)for(const verticalProfile of verticalProfiles()){
    const mode=MODES[name],options={basis,speedMultiplier,verticalProfile};
    const threshold=ballastRequirement(cls,mode,km,options,.05,true,()=>planCalls++,p=>hasOperatingMargin(p,minimum),minimum);
    if(!threshold.feasible)continue;
    consider(mode,{...options,ballastT:threshold.ballastT});
    for(const f of PROFILE_SEARCH.ballastFractions)if(f*cls.payloadT>threshold.ballastT)consider(mode,{...options,ballastT:roundRequirement(f*cls.payloadT)});
  }
  // The unchanged prescribed profiles are part of the stated space too.
  for(const name of PROFILE_SEARCH.modes)for(const speedMultiplier of PROFILE_SEARCH.speedMultipliers){
    const mode=MODES[name],options={basis,speedMultiplier};
    const threshold=ballastRequirement(cls,mode,km,options,.05,true,()=>planCalls++,p=>hasOperatingMargin(p,minimum),minimum);
    if(threshold.feasible){
      consider(mode,{...options,ballastT:threshold.ballastT});
      for(const f of PROFILE_SEARCH.ballastFractions)if(f*cls.payloadT>threshold.ballastT)consider(mode,{...options,ballastT:roundRequirement(f*cls.payloadT)});
    }
  }
  if(best){planCalls++;const p=planCycle(cls,MODES[best.mode],km,null,best.options);if(!hasOperatingMargin(p,minimum))throw new Error('printed profile failed operating-margin replay');}
  return {asDrawn:energySummary(cls,planCycle(cls,MODES.balanced,km,null,{basis})),best,fullDeliveryBest,checked,planCalls:planCalls+1,space:PROFILE_SEARCH,
    meaning:best?'the cheapest feasible profile found in the stated space':'none in the stated space'};
}
