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

## Landing 2 — ord-boyce-land-pinkrobotics-worklog-1001

| field | value |
|---|---|
| Landed | 2026-10-01 21:54:48 PDT by the landing tool (`ship/tools/land.py`) on `ord-boyce-land-pinkrobotics-worklog-1001` from `boyce`, a pure **FAST-FORWARD**: main `5b66169ef8aa23b3c46a2de333a8a88dec938ae7` → `19bfdf527960bb358a2e4a2fa1919edc3cfca2e8`; NOT pushed (--no-push). The signed sha IS main; the landed tree equals the signed tree by identity. |
| The object | SIGNED `19bfdf527960bb358a2e4a2fa1919edc3cfca2e8`, tree `2dcb316e75e20ca9a37f9b3c78a5b173f2d9e30c`, from `pr/worklog` in `/home/tyler/data/t/pr-site-worklog`, parent `36a9f208475c35a7a478d5db0339e228c513011e`, governance `gov-71b7fe41b511` preserved. Unit `not named by the order`. |
| Pre-checks under the lock | primary on main; HEAD == main == the named base; no remote measurement (--no-push); merge-base(main, candidate) == main and candidate != main; tree == the named tree; Helm-Audit-ID on every commit in base..candidate; tracked tree clean; object imported exact from the source. |
| Gate | `tools/land_gate.py 19bfdf527…` → rc=0, HONOURED-XO 19bfdf527960bb358a2e4a2fa1919edc3cfca2e8 — the last record for this sha (store line 639) is XO-SIGNED. (store `/home/tyler/data/helm/tmp/fo-verdicts.tsv`) |
| Evidence before landing | `/home/tyler/.local/node/bin/node --test site/airship3d/tests/control.test.mjs` rc=0: # duration_ms 382.290774 |
| Tool | `ship/tools/land.py` sha256 `9a465ba5134e6406…` from `/home/tyler/dev/helm` (informational) |
| Order | `ord-boyce-land-pinkrobotics-worklog-1001` sha256 `dbdad8a4584fd636…` (informational) |
| Foreign route | order-named preserve_paths `—` pinned — (the attestation post-conditions below refuse any mismatch); record `docs/governance/landing-attestations.md`. |

