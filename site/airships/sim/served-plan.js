/* A bounded page selector. Every candidate is replayed at the route's exact inputs.
 * This chooses among recorded controls; it makes no claim to a global optimum. */
import {CFG,MODES,PHASES} from './config.js?v=816a54f9';
import {planCycle} from './plan.js?v=816a54f9';
import {MODEL_SOURCE_HASHES,SERVED_CANDIDATES} from './served-candidates.js?v=816a54f9';
const cache=new Map();
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
export const modelIdentity=()=>({sources:MODEL_SOURCE_HASHES,importStamp:import.meta.url.split('?v=')[1]||'unstamped-node'});
export function windInput(wind){
 if(wind==null)return {state:'not measured',wind:null};
 if(!Number.isFinite(wind.spd)||wind.spd<0||!Number.isFinite(wind.dir)||!Number.isFinite(wind.bearing))
  throw new RangeError('Wind unavailable: speed, direction and route bearing must all be measured');
 return {state:'measured',wind:{...wind}};
}
export function servedKey(cls,km,wind,requestedMode,candidates){
 return JSON.stringify(stable({model:modelIdentity(),cls,km,wind:windInput(wind),requestedMode,config:{...CFG},candidates}));
}
const deepFreeze=o=>{if(o&&typeof o==='object'&&!Object.isFrozen(o)){Object.values(o).forEach(deepFreeze);Object.freeze(o);}return o;};
export function selectServedPlan(cls,km,wind=null,requestedMode='balanced',candidateOverride){
 const candidates=candidateOverride??SERVED_CANDIDATES[cls.id];
 let key,windState;
 try{
  if(!(Number.isFinite(km)&&km>0)||!MODES[requestedMode]||!Array.isArray(candidates))throw new RangeError('route, mode or candidate set unavailable');
  windState=windInput(wind);key=servedKey(cls,km,wind,requestedMode,candidates);
 }catch(error){return {state:'unavailable',reason:error.message,plan:null,favourable:null};}
 if(cache.has(key))return cache.get(key);
 const trials=[{controls:{mode:requestedMode,options:{speedMultiplier:CFG.speedMul,ballastT:0}},source:{kind:'requested profile'}},...candidates];
 let best=null;const rejected=[];
 try{
  for(const candidate of trials){
   const {mode,options}=candidate.controls;
   // The page selector never changes installed battery power or thrust.
   if(options.requiredBatteryMW!==undefined||options.requiredRotorT!==undefined)throw new RangeError('candidate changes drawn hardware');
   const exactOptions={...options,basis:'record'};
   const plan=planCycle(cls,MODES[mode],km,wind,exactOptions);
   if(!plan.feasible||!(plan.deliveredT>0)){
    rejected.push({mode,reason:plan.bindingLimits.join(', ')||'no positive delivery',worst:plan.worst});continue;
   }
   if(!best||plan.kwhPerTonne<best.plan.kwhPerTonne)best={mode,options:exactOptions,plan,source:candidate.source};
  }
  if(!best){
   const reason='No feasible profile in the bounded candidate set: '+[...new Set(rejected.map(r=>r.reason))].join('; ');
   const result=deepFreeze({state:'stand-down',reason,key,plan:null,favourable:null,rejected,windState:windState.state});cache.set(key,result);return result;
  }
  // A fresh full replay is the acceptance, even when the controls came from another distance.
  const plan=planCycle(cls,MODES[best.mode],km,wind,best.options);
  if(!plan.feasible)throw new Error('selected profile failed exact-input replay');
  const other=planCycle(cls,MODES[best.mode],km,wind,{...best.options,basis:'favourable'});
  const proof={class:cls.id,km,wind:windState,mode:best.mode,options:best.options,config:{...CFG},model:modelIdentity()};
  const result=deepFreeze({state:'ready',key,mode:best.mode,options:best.options,plan,proof,
   requestedT:cls.payloadT,windState:windState.state,source:best.source,candidatesChecked:trials.length,
   favourable:other.feasible?{state:'ready',mode:best.mode,plan:other,proof:{...proof,options:{...best.options,basis:'favourable'}}}
    :{state:'unavailable',reason:'Favourable energy unavailable: the selected controls do not close ('+other.bindingLimits.join(', ')+')',plan:null}});
  cache.set(key,result);return result;
 }catch(error){const result={state:'unavailable',reason:'Plan unavailable: '+error.message,key,plan:null,favourable:null};cache.set(key,result);return result;}
}
export function bindServedMission(m,requestedMode=m.mode.id){
 m.served=true;m.requestedMode=requestedMode;
 const result=selectServedPlan(m.cls,m.legKm,m.wind??null,requestedMode);
 m.selection=result;m.planState=result.state;m.planReason=result.reason||'';m.plan=result.plan;
 if(result.state==='ready'){
  m.mode=MODES[result.mode];m.cycleSec=m.plan.cycleMin*60;
  let acc=0;m.phaseEnds=PHASES.map(([id])=>(acc+=m.plan.dur[id]*60));
 }else{m.cycleSec=0;m.phaseEnds=[];}
 return result;
}
export const missionReady=m=>!!(m&&!m.idle&&m.plan?.feasible&&(!m.served||m.planState==='ready'));
export function auditServedPlan(cls,km,wind,selection,shownMode=selection.mode){
 if(selection.state!=='ready'){
  if(selection.plan)throw new Error('inactive mission carries a plan');return true;
 }
 const proof=selection.proof;
 if(proof.class!==cls.id||proof.km!==km||JSON.stringify(stable(proof.wind))!==JSON.stringify(stable(windInput(wind))))throw new Error('plan inputs differ from this route');
 if(selection.plan.basis!==proof.options.basis)throw new Error('plan basis differs from its proof');
 if(proof.mode!==shownMode||selection.mode!==shownMode)throw new Error('mode label differs from planned mode');
 if(JSON.stringify(stable(proof.config))!==JSON.stringify(stable(CFG))||JSON.stringify(stable(proof.model))!==JSON.stringify(stable(modelIdentity())))throw new Error('plan configuration or model identity changed');
 const replay=planCycle(cls,MODES[proof.mode],km,wind,proof.options);
 if(!replay.feasible||!selection.plan.feasible)throw new Error('served profile is infeasible');
 for(const k of ['cycleMin','eCycleMWh','kwhPerTonne','tph','deliveredT','retainedT','dropsPerHour','gsOut','gsRet'])
  if(!Number.isFinite(selection.plan[k])||Math.abs(selection.plan[k]-replay[k])>1e-9)throw new Error('served figure differs from exact-input replay: '+k);
 return true;
}
