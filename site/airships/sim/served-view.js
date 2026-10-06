/* Page quantities from an accepted exact-input plan. Equipment capacities are separate. */
import {FEASIBILITY_SCOPE} from './energy-label.js?v=816a54f9';
import {diagnosticNotes} from './energy-notes.js?v=816a54f9';
import {MODES} from './config.js?v=816a54f9';
import {fmt,fmtMin} from './format.js?v=816a54f9';
export function planStatusText(result){
 const quantities='Cycle energy, delivered water and delivery rate';
 return result.state==='pending'?`${quantities} pending: feasible plans are computing.`
  :result.state==='stand-down'?`Mission stands down. ${quantities} unavailable: ${result.reason}`
  :`${quantities} unavailable: ${result.reason||'a checked plan is not available'}`;
}
export function workedFigures(cls,km,result){
 if(result.state!=='ready')return {status:planStatusText(result),rows:[],note:'No aircraft has flown.'};
 const p=result.plan,f=result.favourable?.plan;
 const row=(quantity,value,text,label,basis='record')=>({quantity,value,text,label,basis});
 const rows=[row('cycleMin',p.cycleMin,fmtMin(p.cycleMin),'per feasible simulated cycle'),
  row('dropsPerHour',p.dropsPerHour,p.dropsPerHour.toFixed(1),'cycles per hour'),
  row('requestedT',cls.payloadT,fmt(cls.payloadT)+' t','water requested'),
  row('retainedT',p.retainedT,fmt(p.retainedT)+' t','water kept aboard'),
  row('deliveredT',p.deliveredT,fmt(p.deliveredT)+' t','water delivered per cycle'),
  row('tph',p.tph,fmt(p.tph)+' t/h','delivered water per hour'),
  row('eCycleMWh',p.eCycleMWh,p.eCycleMWh.toFixed(1)+' MWh','energy supplied per cycle · record'),
  row('kwhPerTonne',p.kwhPerTonne,fmt(p.kwhPerTonne)+' kWh/t','per delivered tonne · record')];
 if(f)rows.push(row('eCycleMWh',f.eCycleMWh,f.eCycleMWh.toFixed(1)+' MWh','energy supplied per cycle · favourable','favourable'),
  row('kwhPerTonne',f.kwhPerTonne,fmt(f.kwhPerTonne)+' kWh/t','per delivered tonne · favourable','favourable'));
 return {rows,status:'',note:`${cls.name} · planned ${MODES[result.mode].label.toLowerCase()} mode · ${km} km one-way · wind not measured; still-air plan. Water requested ${fmt(cls.payloadT)} t; kept ${fmt(p.retainedT)} t; delivered ${fmt(p.deliveredT)} t. Record basis closes on the drawn power and thrust limits. ${FEASIBILITY_SCOPE} ${diagnosticNotes(cls,km,result).join('. ')}${diagnosticNotes(cls,km,result).length?'. ':''}${f?'The same controls also close on the favourable basis.':result.favourable?.reason} Limiting constraint: ${p.bottleneck}. A bounded choice of recorded controls; structural float and flight performance remain unproven. Water released is not fire extinguished. No aircraft has flown.`};
}
