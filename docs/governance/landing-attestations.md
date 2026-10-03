# Landing attestations

## Landing 1 — FOUNDATIONS: how to direct the ship here (Pink Robotics)

| field | value |
|---|---|
| Landed | 2026-09-27 08:51:45 PDT by the landing tool (`ship/tools/land.py`) from `boyce`, a pure **FAST-FORWARD**: main `6f49e8d7032f061d36450a56eda4b32d196f8343` → `4d8ac2b2125ca2f4b442da9a1b92f510f5dd5489`; NOT pushed (--no-push). The signed sha IS main; the landed tree equals the signed tree by identity. |
| The object | SIGNED `4d8ac2b2125ca2f4b442da9a1b92f510f5dd5489`, tree `740193d6037b27555d42c28aba317bb44013a872`, from `foundations-0927` (source checkout redacted), parent `6f49e8d7032f061d36450a56eda4b32d196f8343`, governance `gov-e06b16036266` preserved. Unit `not named by the order`. |
| Pre-checks under the lock | primary on main; HEAD == main == the named base; no remote measurement (--no-push); merge-base(main, candidate) == main and candidate != main; tree == the named tree; Helm-Audit-ID on every commit in base..candidate; tracked tree clean; object imported exact from the source. |
| Gate | `tools/land_gate.py 4d8ac2b21…` → rc=0, HONOURED-XO 4d8ac2b2125ca2f4b442da9a1b92f510f5dd5489 — the last record for this sha (store line 538) is XO-SIGNED. (store redacted) |
| Evidence before landing | `redacted --test site/airship3d/tests/control.test.mjs` rc=0: # duration_ms 115.365378 |
| Tool | `ship/tools/land.py` sha256 `ef13c5960a5bd0de…` (informational) |
| Order | sha256 `40efef0817877c74…` (informational) |
| Foreign route | order-named preserve_paths `—` pinned — (the attestation post-conditions below refuse any mismatch); record `docs/governance/landing-attestations.md` (created by this landing). |

## Landing 2 — The work log's generator: built from the record, held to a public boundary

| field | value |
|---|---|
| Landed | 2026-10-01 21:54:48 PDT by the landing tool (`ship/tools/land.py`) from `boyce`, a pure **FAST-FORWARD**: main `5b66169ef8aa23b3c46a2de333a8a88dec938ae7` → `19bfdf527960bb358a2e4a2fa1919edc3cfca2e8`; NOT pushed (--no-push). The signed sha IS main; the landed tree equals the signed tree by identity. |
| The object | SIGNED `19bfdf527960bb358a2e4a2fa1919edc3cfca2e8`, tree `2dcb316e75e20ca9a37f9b3c78a5b173f2d9e30c`, from `pr/worklog` (source checkout redacted), parent `36a9f208475c35a7a478d5db0339e228c513011e`, governance `gov-71b7fe41b511` preserved. Unit `not named by the order`. |
| Pre-checks under the lock | primary on main; HEAD == main == the named base; no remote measurement (--no-push); merge-base(main, candidate) == main and candidate != main; tree == the named tree; Helm-Audit-ID on every commit in base..candidate; tracked tree clean; object imported exact from the source. |
| Gate | `tools/land_gate.py 19bfdf527…` → rc=0, HONOURED-XO 19bfdf527960bb358a2e4a2fa1919edc3cfca2e8 — the last record for this sha (store line 639) is XO-SIGNED. (store redacted) |
| Evidence before landing | `redacted --test site/airship3d/tests/control.test.mjs` rc=0: # duration_ms 382.290774 |
| Tool | `ship/tools/land.py` sha256 `9a465ba5134e6406…` (informational) |
| Order | sha256 `dbdad8a4584fd636…` (informational) |
| Foreign route | order-named preserve_paths `—` pinned — (the attestation post-conditions below refuse any mismatch); record `docs/governance/landing-attestations.md`. |

## Landing 3 — A batch can name its own landing on the work log

| field | value |
|---|---|
| Landed | 2026-10-01 23:56:10 PDT by the landing tool (`ship/tools/land.py`) from `boyce`, a pure **FAST-FORWARD**: main `452fe925a847ba875d4488e49fcb9c5786d49bb4` → `a5dc4a4097770c6a0822e328a898c9f6062e3755`; NOT pushed (--no-push). The signed sha IS main; the landed tree equals the signed tree by identity. |
| The object | SIGNED `a5dc4a4097770c6a0822e328a898c9f6062e3755`, tree `31c8998dcb4e8db5d18943f625b7b526adbbdb4e`, from `pr/boundary` (source checkout redacted), parent `9bdd9aad26ec08f1dd9bd34bf265c5ce9feaa9b4`, governance `gov-7ce3c89f50eb` preserved. Unit `not named by the order`. |
| Pre-checks under the lock | primary on main; HEAD == main == the named base; no remote measurement (--no-push); merge-base(main, candidate) == main and candidate != main; tree == the named tree; Helm-Audit-ID on every commit in base..candidate; tracked tree clean; object imported exact from the source. |
| Gate | `tools/land_gate.py a5dc4a409…` → rc=0, HONOURED-XO a5dc4a4097770c6a0822e328a898c9f6062e3755 — the last record for this sha (store line 648) is XO-SIGNED. (store redacted) |
| Evidence before landing | `make activity-test` rc=0: OK |
| Tool | `ship/tools/land.py` sha256 `5aa40860c75cf358…` (informational) |
| Order | sha256 `518c7b50b0d296e0…` (informational) |
| Foreign route | order-named preserve_paths `—` pinned — (the attestation post-conditions below refuse any mismatch); record `docs/governance/landing-attestations.md`. |

## Landing 4 — A stranger can check the site repository offline with one command

| field | value |
|---|---|
| Landed | 2026-10-02 05:48:46 PDT by the lander using `ship/tools/land.py`, a pure **FAST-FORWARD**: main `44b6b5e244c584722a975e42479b907c2cb0078b` → `fac7d2578bcbea72b629a71fc7c9cdf09c5c2bfd`; NOT pushed (--no-push). The signed sha IS main; the landed tree equals the signed tree by identity. |
| The object | SIGNED `fac7d2578bcbea72b629a71fc7c9cdf09c5c2bfd`, tree `74829bf3ffd318d732891e5d5b5546577328bf2c`, from `pr/site2` (source checkout redacted), parent `d48abc204bbcecb475e5113b7c33232d4489aa22`, governance `gov-2cca943bbc50` preserved. |
| Pre-checks under the lock | primary on main; HEAD == main == the named base; no remote measurement (--no-push); merge-base(main, candidate) == main and candidate != main; tree == the named tree; Helm-Audit-ID on every commit in base..candidate; tracked tree clean; object imported exact from the source. |
| Gate | `tools/land_gate.py fac7d2578…` → rc=0, HONOURED-XO fac7d2578bcbea72b629a71fc7c9cdf09c5c2bfd — the last record for this sha is XO-SIGNED. (store redacted) |
| Evidence before landing | `bash -c export PATH="$PATH:$HOME/.local/node/bin"; exec make --no-print-directory check TMPDIR="$PWD/.scratch"` rc=0: OK |
| Tool | `ship/tools/land.py` sha256 `8337aade9e7b427d…` (informational) |
| Order | sha256 `33dd407620c86855…` (informational) |
| Foreign route | order-named preserve_paths `—` pinned — (the attestation post-conditions below refuse any mismatch); record `docs/governance/landing-attestations.md`. |

## Landing 5 — The seed is compared with the live site; every tracked file is gated

| field | value |
|---|---|
| Landed | 2026-10-02 18:08:48 PDT by the lander using `ship/tools/land.py`, a pure **FAST-FORWARD**: main `b91c9098bba4c1d4691b6532952e08040be8b85a` → `1f18812d7e07d1aabf0dc96faeb6671c0420ade1`; NOT pushed (--no-push). The signed sha IS main; the landed tree equals the signed tree by identity. |
| The object | SIGNED `1f18812d7e07d1aabf0dc96faeb6671c0420ade1`, tree `5ad5cab595b6ca9d88c8b78df718865372219aa4`, from `pr/site5` (source checkout redacted), parent `03f68f741f996d28ac0edd5be5ba1824110c0d87`, governance `gov-97884101f266` preserved. |
| Pre-checks under the lock | primary on main; HEAD == main == the named base; no remote measurement (--no-push); merge-base(main, candidate) == main and candidate != main; tree == the named tree; Helm-Audit-ID on every commit in base..candidate; tracked tree clean; object imported exact from the source. |
| Gate | `tools/land_gate.py 1f18812d7…` → rc=0, HONOURED-XO 1f18812d7e07d1aabf0dc96faeb6671c0420ade1 — the last record for this sha is XO-SIGNED. (store redacted) |
| Evidence before landing | `bash redacted redacted` rc=0 |
| Tool | `ship/tools/land.py` sha256 `d4ad25b6e0d27bd0…` (informational) |
| Order | sha256 `37c77651fa432c53…` (informational) |
| Foreign route | order-named preserve_paths `—` pinned — (the attestation post-conditions below refuse any mismatch); record `docs/governance/landing-attestations.md`. |

## Landing 6 — The local operating files leave the repository

| field | value |
|---|---|
| Landed | 2026-10-02 18:53:46 PDT by the lander using `ship/tools/land.py`, a pure **FAST-FORWARD**: main `78de700d088a9b5ee16ce41fddc7d9d35e0cb05d` → `b3c32fa49fa4887a98a7e5c711586c4bac450917`; NOT pushed (--no-push). The signed sha IS main; the landed tree equals the signed tree by identity. |
| The object | SIGNED `b3c32fa49fa4887a98a7e5c711586c4bac450917`, tree `b3e924de2a1044f88bdc48ce4b03cf7d854308cf`, from `pr/site5-del` (source checkout redacted), parent `78de700d088a9b5ee16ce41fddc7d9d35e0cb05d`, governance `gov-07ea8fcb7d88` preserved. |
| Pre-checks under the lock | primary on main; HEAD == main == the named base; no remote measurement (--no-push); merge-base(main, candidate) == main and candidate != main; tree == the named tree; Helm-Audit-ID on every commit in base..candidate; tracked tree clean; object imported exact from the source. |
| Gate | `tools/land_gate.py b3c32fa49…` → rc=0, HONOURED-XO b3c32fa49fa4887a98a7e5c711586c4bac450917 — the last record for this sha is XO-SIGNED. (store redacted) |
| Evidence before landing | `bash redacted redacted` rc=0 |
| Tool | `ship/tools/land.py` sha256 `d4ad25b6e0d27bd0…` (informational) |
| Order | sha256 `73e3bec50578ea1c…` (informational) |
| Foreign route | order-named preserve_paths `—` pinned — (the attestation post-conditions below refuse any mismatch); record `docs/governance/landing-attestations.md`. |

