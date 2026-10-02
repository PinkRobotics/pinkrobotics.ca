/* The invented view is separate from the dated-day and mirror fallback routes.
 * Every historical keep-out is retained, regardless of its date. */
import { havKm, keepOutsFor, setSeed } from '../sim/index.js?v=762fdcfd';
import { fetchJSON } from './net.js?v=762fdcfd';
import { S } from './store.js?v=762fdcfd';

export const EXERCISE_MODE = 'Exercise: every fire on this map is invented. The terrain, the lakes and the distances are real.';
export const EXERCISE_NOTE = 'No fire shown here happened. No aircraft flew. The exercise shows how the simulated fleet chooses under load. Its ground was chosen at least 150 km from every 2026 fire on the guard list and from every wildfire of note in the season record.';

export async function loadExercise(normalize, fetchDayFile) {
  S.exercise = true; S.day = null; S.daySource = 'exercise'; S.tier = 'exercise';
  S.fetchedAt = null; S.snapshotDate = null; S.usingFallback = false;
  S.recordWindow = false; S.unknownDay = null;
  try {
    if (!S.guard?.ok || S.seasonNote) throw new Error('the complete guard and season context did not load');
    const doc = await fetchJSON('data/exercise/exercise.json', 20000);
    if (doc.kind !== 'exercise' || !Number.isInteger(doc.seed) || doc.label !== EXERCISE_MODE || doc.note !== EXERCISE_NOTE)
      throw new Error('the exercise identity or labels are invalid');
    if (!doc.fires?.features?.length || !doc.perimeters?.features)
      throw new Error('the exercise has no fire or outline collection');
    for (const f of doc.fires.features) {
      const p = f.properties;
      if (!p.EXERCISE || !/^EX\d{3}$/.test(p.FIRE_NUMBER) || p.INCIDENT_NAME !== 'Exercise ' + p.FIRE_NUMBER.slice(2))
        throw new Error('an exercise fire is not labelled as invented');
    }
    const season = await fetchJSON('data/season/2026.json', 30000);
    if (!Array.isArray(season.fires) || !season.fires.length) throw new Error('the season geography is missing');
    const history = season.fires.map(f => ({id:f.fire, name:f.name,
      ll:[f.lon,f.lat], sizeHa:f.hindsightSizeHa, note:!!(f.fireOfNote || f.wasFireOfNote)}));
    const regions = keepOutsFor(S.guard, history, {seasonOfNote:S.seasonOfNote});
    for (const d of S.dayList) {
      const [fires, perims] = await Promise.all([fetchDayFile(d.fires.file, d.fires), fetchDayFile(d.perims.file, d.perims)]);
      regions.push(...keepOutsFor(S.guard, normalize(fires.data, perims.data), {seasonOfNote:S.seasonOfNote}, d.date));
    }
    for (const p of S.guard.places) regions.push(...keepOutsFor(S.guard, [], {}, p.date));
    // Each enclosing disc contains every historical polygon plus its keep-out band.
    // Keeping one disc per entry is conservative and makes per-frame checks inexpensive.
    const groups = new Map();
    for (const r of regions) {
      const key = r.kind + ':' + r.who;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    S.exerciseRegions = [...groups.values()].map(rs => {
      // Order areas have an outline, with no centre in the evacuation record.
      const ll = (rs[0].ll || rs[0].edge[0]).slice();
      const rKm = Math.max(...rs.flatMap(r => (r.edge || [r.ll]).map(p => havKm(ll,p) + r.rKm))) + .01;
      return {...rs[0], ll, rKm, ring:null, edge:null};
    });
    // Store the raw union as evidence for the exercise gate; the allocator uses its
    // conservative envelope, so it cannot ignore a keep-out from another date.
    S.exerciseHistoricalRegions = regions;
    setSeed(doc.seed);
    S.recordOnly = false; S.standDown = null; S.perimsOk = true;
    S.dataNote = EXERCISE_NOTE;
    return normalize(doc.fires, doc.perimeters);
  } catch (e) {
    // A clause that ends "..., because": the page's sentences for an empty view are built on it.
    S.recordOnly = true; S.standDown = 'the exercise could not be read (' + e.message + ')';
    S.dataNote = S.standDown; S.perimsOk = false;
    S.exerciseRegions = []; S.exerciseHistoricalRegions = [];
    return [];
  }
}
