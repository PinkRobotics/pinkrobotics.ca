/* Independent climb and letdown controls for the searched profile.
 * Rates are peak vertical speeds. Airspeeds are peaks of a smooth pulse.
 * The integral of that pulse is two thirds of its peak times its duration. */
import {ALT, ALT_DROP_TOP} from './config.js?v=68694086';
import {easeSm} from './geo.js?v=68694086';

export const VERTICAL_PROFILE_GRID = {
  climbRateMps: [0.5, 2], letdownRateMps: [0.5, 2],
  climbAirspeedMps: [0, 5], letdownAirspeedMps: [0, 5],
};
export function verticalProfiles() {
  const rows=[{}];
  for(const [key,values] of Object.entries(VERTICAL_PROFILE_GRID)) {
    const prior=rows.splice(0);
    for(const row of prior)for(const value of values)rows.push({...row,[key]:value});
  }
  return rows;
}
export function profilePoint(segments, seconds) {
  let t=Math.max(0,seconds);
  for(let i=0;i<segments.length;i++) {
    const s=segments[i];
    if(t<=s.seconds || i===segments.length-1) {
      const x=Math.min(1,t/Math.max(1e-12,s.seconds));
      return {alt:s.from+(s.to-s.from)*easeSm(x),airV:s.airspeedMps*4*x*(1-x)};
    }
    t-=s.seconds;
  }
  throw new Error('empty vertical profile');
}
/** Keep the prescribed return's altitude endpoints, easing short vertical joins.
 * easeSm has |f'| <= 1.5 and |f''| <= 6; easeTrap has |g'| <= 1/.85
 * and |g''| <= 1/(.15*.85). Their composition at join width w therefore has
 * |d²alt/dprogress²| <= 6H/(.85w)² + 1.5H/(.15*.85w).
 * Dividing by phase seconds and 2000 bounds the adjacent speed step to E11's
 * 0.1 m/s. A central-difference average cannot increase this Lipschitz bound.
 * Widen joins first; extend time only if the two joins would overlap. */
export function prescribedReturnJoins(g, seconds) {
  const height=[Math.abs(g.altTop-g.altEsc),Math.abs(g.altTop-g.holdAgl)];
  const bound=(h,w)=>6*h/(.85*w)**2+1.5*h/(.15*.85*w);
  if(g.altTop<Math.min(g.altEsc,g.holdAgl))
    return {seconds:Math.max(seconds,6*Math.abs(g.holdAgl-g.altEsc)/200),widths:[.3,.3]};
  const width=(h,t)=>{
    const a=6*h/.85**2,b=1.5*h/(.15*.85),limit=200*t;
    return Math.max(.3,(b+Math.sqrt(b*b+4*limit*a))/(2*limit));
  };
  let widths=height.map(h=>width(h,seconds));
  if(widths[0]+widths[1]>1){
    seconds=Math.max(seconds,...height.map(h=>bound(h,.5)/200))*(1+1e-9);
    widths=height.map(h=>width(h,seconds));
  }
  return {seconds,widths};
}

export function searchedProfile(plan,g,oneWayKm,options,tailOutMps=0) {
  for(const [key,value] of Object.entries(options)) {
    if(!(key in VERTICAL_PROFILE_GRID)||!Number.isFinite(value)||value<0)throw new RangeError('invalid profile parameter '+key);
  }
  for(const key of Object.keys(VERTICAL_PROFILE_GRID))if(!(key in options))throw new RangeError('missing profile parameter '+key);
  if(!(options.climbRateMps>0&&options.letdownRateMps>0))throw new RangeError('vertical rates must be positive');
  const vertical=(from,to,minSeconds=0)=>{
    const climb=to>=from,rate=climb?options.climbRateMps:options.letdownRateMps;
    const seconds=Math.max(minSeconds,1.5*Math.abs(to-from)/rate);
    const airspeedMps=climb?options.climbAirspeedMps:options.letdownAirspeedMps;
    return {from,to,seconds,airspeedMps,distanceM:seconds*airspeedMps*2/3};
  };
  const approach=vertical(g.holdAgl,g.srcAlt,plan.dur.SOURCE_APPROACH*60);
  // Cable pickup requires station holding. No approach at airspeed is assumed.
  approach.airspeedMps=0;approach.distanceM=0;
  const escape=vertical(ALT_DROP_TOP,g.altEsc,plan.dur.BUOYANCY_ESCAPE*60);
  const phases={SOURCE_APPROACH:[approach],BUOYANCY_ESCAPE:[escape]};
  const legs={};
  for(const [id,start,end,groundCruise,wind,extra] of [
    ['OUTBOUND_TRANSIT',g.srcAlt,ALT.drop,plan.gsOut/3.6,tailOutMps,0],
    ['RETURN_TRANSIT',g.altEsc,g.holdAgl,plan.gsRet/3.6,-tailOutMps,escape.distanceM],
  ]) {
    const top=Math.max(g.altTop,start,end),up=vertical(start,top),down=vertical(top,end);
    // Bound acceleration at short joins as well as peak rate. With 2001 samples,
    // 6*height/seconds^2 * phaseSeconds <= 50 bounds adjacent speed changes.
    // Recompute distance and cruise time after each duration increase.
    const cruiseAir=groundCruise-wind,cruiseMean=cruiseAir*2/3+wind;
    let remainingM,seconds;
    for(let pass=0;pass<40;pass++) {
      up.distanceM=up.seconds*(up.airspeedMps*2/3+wind);
      down.distanceM=down.seconds*(down.airspeedMps*2/3+wind);
      remainingM=oneWayKm*1000-extra-up.distanceM-down.distanceM;
      seconds=remainingM>=0&&cruiseMean>0?remainingM/cruiseMean:0;
      const total=up.seconds+down.seconds+seconds;
      let changed=false;
      for(const segment of [up,down]) {
        const minimum=Math.sqrt(6*Math.abs(segment.to-segment.from)*total/50);
        if(segment.seconds<minimum){segment.seconds=minimum*(1+1e-9);changed=true;}
      }
      if(!changed)break;
    }
    const level={from:top,to:top,seconds,airspeedMps:cruiseAir,distanceM:seconds*cruiseMean};
    phases[id]=[up,level,down].filter(s=>s.seconds>0);
    legs[id]={distanceM:extra+up.distanceM+level.distanceM+down.distanceM,targetM:oneWayKm*1000,
      fits:remainingM>=0&&cruiseMean>0,windMps:wind,extraDistanceM:extra};
  }
  for(const [id,segments] of Object.entries(phases))plan.dur[id]=segments.reduce((n,s)=>n+s.seconds,0)/60;
  return {parameters:{...options},phases,legs,feasibleGeometry:Object.values(legs).every(l=>l.fits)};
}
