# Landing attestations

## Landing 1 — FOUNDATIONS: how to direct the ship here (Pink Robotics)

| field | value |
|---|---|
| Landed | 2026-09-27 08:51:45 PDT by the landing tool (`ship/tools/land.py`) on `ord-boyce-land-pinkrobotics-foundations-0927` from `boyce`, a pure **FAST-FORWARD**: main `6f49e8d7032f061d36450a56eda4b32d196f8343` → `4d8ac2b2125ca2f4b442da9a1b92f510f5dd5489`; NOT pushed (--no-push). The signed sha IS main; the landed tree equals the signed tree by identity. |
| The object | SIGNED `4d8ac2b2125ca2f4b442da9a1b92f510f5dd5489`, tree `740193d6037b27555d42c28aba317bb44013a872`, from `foundations-0927` in `/home/tyler/data/t/wt-pinkrobotics`, parent `6f49e8d7032f061d36450a56eda4b32d196f8343`, governance `gov-e06b16036266` preserved. Unit `not named by the order`. |
| Pre-checks under the lock | primary on main; HEAD == main == the named base; no remote measurement (--no-push); merge-base(main, candidate) == main and candidate != main; tree == the named tree; Helm-Audit-ID on every commit in base..candidate; tracked tree clean; object imported exact from the source. |
| Gate | `tools/land_gate.py 4d8ac2b21…` → rc=0, HONOURED-XO 4d8ac2b2125ca2f4b442da9a1b92f510f5dd5489 — the last record for this sha (store line 538) is XO-SIGNED. (store `/home/tyler/data/helm/tmp/fo-verdicts.tsv`) |
| Evidence before landing | `/home/tyler/.local/node/bin/node --test site/airship3d/tests/control.test.mjs` rc=0: # duration_ms 115.365378 |
| Tool | `ship/tools/land.py` sha256 `ef13c5960a5bd0de…` from `/home/tyler/dev/helm` (informational) |
| Order | `ord-boyce-land-pinkrobotics-foundations-0927` sha256 `40efef0817877c74…` (informational) |
| Foreign route | order-named preserve_paths `—` pinned — (the attestation post-conditions below refuse any mismatch); record `docs/governance/landing-attestations.md` (created by this landing). |

