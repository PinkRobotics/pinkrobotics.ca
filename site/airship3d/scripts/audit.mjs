/* Print the geometric consistency audit.
 *
 *   node scripts/audit.mjs [--class P100] [--verbose]
 *
 * The checks themselves live in model/audit.js so the test suite asserts exactly what this prints.
 * Exit status is non-zero when anything is found, so it can gate a deploy.
 */

import { build } from '../model/build.js';
import { auditBuild, CLASS_IDS } from '../model/audit.js';

const args = process.argv.slice(2);
const only = args.includes('--class') ? args[args.indexOf('--class') + 1] : null;
const verbose = args.includes('--verbose');
const cap = verbose ? 999 : 8;

let problems = 0;
for (const id of (only ? [only] : CLASS_IDS)) {
  const b = build(id, { tier: 3 });
  const r = auditBuild(b);
  console.log(`\n=== ${b.cls.name} — ${r.volumes} volumes ===`);

  const section = (label, list, fmt) => {
    if (!list.length) { console.log(`  ${label}: clean`); return; }
    problems += list.length;
    console.log(`  ${label}: ${list.length} finding(s)`);
    for (const x of list.slice(0, cap)) console.log(`    ${fmt(x)}`);
    if (list.length > cap) console.log(`    … and ${list.length - cap} more`);
  };

  section('CONTAINMENT', r.containment, (x) => `${x.id.padEnd(26)} ${x.depth.toFixed(2)} m outside`);
  section('INTERFERENCE (machinery)', r.machinery,
    (x) => `${x.a.padEnd(24)} ∩ ${x.b.padEnd(24)} ${x.ov.toFixed(2)} m`);
  section('INTERFERENCE (cells vs machinery)', r.cellsVsMachinery,
    (x) => `${x.a.padEnd(24)} ∩ ${x.b.padEnd(24)} ${x.ov.toFixed(2)} m`);
  if (verbose) console.log(`  (cell-to-cell contact: ${r.cellToCell} pairs — expected)`);
}

console.log(`\n${problems === 0 ? 'audit: clean' : `audit: ${problems} finding(s)`}`);
process.exit(problems === 0 ? 0 : 1);
