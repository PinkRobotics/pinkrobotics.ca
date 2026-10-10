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

## Landing 7 — Every injected script but the e-mail decoder is a finding; a listed name stays red

| field | value |
|---|---|
| Landed | 2026-10-02 19:29:09 PDT by the lander using `ship/tools/land.py`, a pure **FAST-FORWARD**: main `16a28649ccf1657f811422c7ecc54c9f81a0b10a` → `2f03ce5dc749b67d206543acc7a43e80945b9e8a`; NOT pushed (--no-push). The signed sha IS main; the landed tree equals the signed tree by identity. |
| The object | SIGNED `2f03ce5dc749b67d206543acc7a43e80945b9e8a`, tree `4918a5be88aeecd0cb1b4d1a1b4cbbb79cfd7cbc`, from `pr/site7` (source checkout redacted), parent `baefe98cac32ea5e5c92d1ca06f9fca1c8fa0424`, governance `gov-95ad8fd28d7e` preserved. |
| Pre-checks under the lock | primary on main; HEAD == main == the named base; no remote measurement (--no-push); merge-base(main, candidate) == main and candidate != main; tree == the named tree; Helm-Audit-ID on every commit in base..candidate; tracked tree clean; object imported exact from the source. |
| Gate | `tools/land_gate.py 2f03ce5dc…` → rc=0, HONOURED-XO 2f03ce5dc749b67d206543acc7a43e80945b9e8a — the last record for this sha is XO-SIGNED. (store redacted) |
| Evidence before landing | `bash redacted redacted` rc=0 |
| Tool | `ship/tools/land.py` sha256 `d4ad25b6e0d27bd0…` (informational) |
| Order | sha256 `069324dd83685afd…` (informational) |
| Foreign route | order-named preserve_paths `—` pinned — (the attestation post-conditions below refuse any mismatch); record `docs/governance/landing-attestations.md`. |

## Landing 8 — Show who checked each landing and what it cost

| field | value |
|---|---|
| Landed | 2026-10-04 08:10:01 PDT by the lander using `ship/tools/land.py`, a pure **FAST-FORWARD**: main `0095b0ca2c7c8f85270335dea8499282b1ee1f65` → `ece309c12aa14ef32924bf5b209ce7839acd7cc0`; NOT pushed (--no-push). The signed sha IS main; the landed tree equals the signed tree by identity. |
| The object | SIGNED `ece309c12aa14ef32924bf5b209ce7839acd7cc0`, tree `e450408bd1ec8e7a562d37abead8368c40afb601`, from `pr/site8` (source checkout redacted), parent `d59f6b195e12a9e5b48bff32533cdb4d7303fd51`, governance `gov-62278a1a4c6f` preserved. |
| Pre-checks under the lock | primary on main; HEAD == main == the named base; no remote measurement (--no-push); merge-base(main, candidate) == main and candidate != main; tree == the named tree; Helm-Audit-ID on every commit in base..candidate; tracked tree clean; object imported exact from the source. |
| Gate | `tools/land_gate.py ece309c12…` → rc=0, HONOURED-XO ece309c12aa14ef32924bf5b209ce7839acd7cc0 — the last record for this sha is XO-SIGNED. (store redacted) |
| Evidence before landing | `bash redacted redacted` rc=0 |
| Tool | `ship/tools/land.py` sha256 `c0d17fe009ac84c3…` (informational) |
| Order | sha256 `4ceaee163e3ee861…` (informational) |
| Foreign route | order-named preserve_paths `—` pinned — (the attestation post-conditions below refuse any mismatch); record `docs/governance/landing-attestations.md`. |

## Landing 9 — Licence the code Apache-2.0 and our text and figures CC BY 4.0

| field | value |
|---|---|
| Landed | 2026-10-04 12:20:09 PDT by the lander using `ship/tools/land.py`, a pure **FAST-FORWARD**: main `5719b4d2d3438d06a812d88e982bcafbc2587333` → `0129d3beeb919574fcdfd6ceb5aaa9e9cd89f829`; NOT pushed (--no-push). The signed sha IS main; the landed tree equals the signed tree by identity. |
| The object | SIGNED `0129d3beeb919574fcdfd6ceb5aaa9e9cd89f829`, tree `a4491a0e6d4e1de29c8c590894f7a457bd50fa67`, from `pr/site9` (source checkout redacted), parent `5719b4d2d3438d06a812d88e982bcafbc2587333`, governance `gov-0f776b1ddab0` preserved. |
| Pre-checks under the lock | primary on main; HEAD == main == the named base; no remote measurement (--no-push); merge-base(main, candidate) == main and candidate != main; tree == the named tree; Helm-Audit-ID on every commit in base..candidate; tracked tree clean; object imported exact from the source. |
| Gate | `tools/land_gate.py 0129d3bee…` → rc=0, HONOURED-XO 0129d3beeb919574fcdfd6ceb5aaa9e9cd89f829 — the last record for this sha is XO-SIGNED. (store redacted) |
| Evidence before landing | `bash redacted redacted` rc=0 |
| Tool | `ship/tools/land.py` sha256 `c0d17fe009ac84c3…` (informational) |
| Order | sha256 `a21211dfb7a79b2f…` (informational) |
| Foreign route | order-named preserve_paths `—` pinned — (the attestation post-conditions below refuse any mismatch); record `docs/governance/landing-attestations.md`. |

## Landing 10 — Trim the stale exception rows, re-seed the site from the deployed tree, and keep footers whole at phone width

| field | value |
|---|---|
| Landed | 2026-10-05 03:24:41 PDT by the lander using `ship/tools/land.py`, a pure **FAST-FORWARD**: main `87573c59ebc0a90414ffd93a2effaa7cbbb373ff` → `b4341bf850927b5421263317eb6ad3190c1f0119`; NOT pushed (--no-push). The signed sha IS main; the landed tree equals the signed tree by identity. |
| The object | SIGNED `b4341bf850927b5421263317eb6ad3190c1f0119`, tree `fe3e7b737b31d16aa9d576542514c809eb7e2207`, from `pr/site10` in `/home/tyler/data/t/pr-site10`, parent `fff8d14de733670569eb51f5f0422b047e59835e`, governance `gov-91a1400e2830` preserved. |
| Pre-checks under the lock | primary on main; HEAD == main == the named base; no remote measurement (--no-push); merge-base(main, candidate) == main and candidate != main; tree == the named tree; Helm-Audit-ID on every commit in base..candidate; tracked tree clean; object imported exact from the source. |
| Gate | `tools/land_gate.py b4341bf85…` → rc=0, HONOURED-XO b4341bf850927b5421263317eb6ad3190c1f0119 — the last record for this sha (store line 849) is XO-SIGNED. (store `/home/tyler/data/helm/tmp/fo-verdicts.tsv`) |
| Governance records | `cbedc9023` ← `gov-409be0ed7742` (its trailer); `96ea4686e` ← `gov-6f9a01e666ff` (its trailer); `0391b87a9` ← `gov-8ce539c5cbf4` (its trailer); `092ade6dd` ← `gov-6fd3aaff47d1` (its trailer); `b2225722b` ← `gov-7868ba9f0bcc` (its trailer); `fff8d14de` ← `gov-1f3aa6ace5e8` (its trailer); `b4341bf85` ← `gov-91a1400e2830` (its trailer). Each record names the landed sha as the commit it governed. |
| Evidence before landing | `bash -c 'export PATH="$PATH:$HOME/.local/node/bin"; export PUBLIC_DENY_FILE=/home/tyler/data/t/pr-scrub-work/private-deny.txt; out=$(make --no-print-directory check TMPDIR="$PWD/.scratch" 2>&1); rc=$?; printf "%s\n" "$out"; [ "$rc" -eq 0 ] \|\| exit "$rc"; printf "%s\n" "$out" \| grep "private-list=loaded" \| tail -n 1 \| grep . \|\| { echo "HOLD: the private list did not load"; exit 3; }'` rc=0 |
| Tool | `ship/tools/land.py` sha256 `7ad33759f7af8e0b…` from `/home/tyler/dev/helm` (informational) |
| Order | sha256 `01ddde97b0c69bfd…` (informational) |
| Foreign route | order-named preserve_paths `—` pinned — (the attestation post-conditions below refuse any mismatch); record `docs/governance/landing-attestations.md`. |

## Landing 11 — Fix what a first reader found on the site; withhold two screenshots

| field | value |
|---|---|
| Landed | 2026-10-05 10:29:29 PDT by the lander using `ship/tools/land.py`, a pure **FAST-FORWARD**: main `917d21f3331d71f85433b5121aad2b06c1a02f9f` → `730ebfc151a86837e2e98a975878fb15b220f82d`; NOT pushed (--no-push). The signed sha IS main; the landed tree equals the signed tree by identity. |
| The object | SIGNED `730ebfc151a86837e2e98a975878fb15b220f82d`, tree `407402761fe20cf9a85e760d7cd2879dddeb8631`, from `pr/site11` in `/home/tyler/data/t/pr-site11`, parent `57e28e498040ac6da00f9368927b67fc78d7e7d0`, governance `gov-d730d12d89aa` preserved. |
| Pre-checks under the lock | primary on main; HEAD == main == the named base; no remote measurement (--no-push); merge-base(main, candidate) == main and candidate != main; tree == the named tree; Helm-Audit-ID on every commit in base..candidate; tracked tree clean; object imported exact from the source. |
| Gate | `tools/land_gate.py 730ebfc15…` → rc=0, HONOURED-XO 730ebfc151a86837e2e98a975878fb15b220f82d — the last record for this sha (store line 874) is XO-SIGNED. (store `/home/tyler/data/helm/tmp/fo-verdicts.tsv`) |
| Governance records | `e1b1f0fbc` ← `gov-4f4ca5034f7f` (its trailer); `736dab271` ← `gov-d9374cf9409b` (its trailer); `3eba70d1b` ← `gov-4810f7692fa3` (its trailer); `3b5e63f13` ← `gov-fb9ff2c824c2` (its trailer); `05c8ca130` ← `gov-2c9493703a7c` (its trailer); `f237f5ace` ← `gov-315091288f01` (its trailer); `775c5ac6b` ← `gov-7bf00660354d` (its trailer); `1310fadd2` ← `gov-832ce48f095a` (its trailer); `57e28e498` ← `gov-6c25a1506939` (its trailer); `730ebfc15` ← `gov-d730d12d89aa` (its trailer). Each record names the landed sha as the commit it governed. |
| Evidence before landing | `bash -c 'export PATH="$PATH:$HOME/.local/node/bin"; export PUBLIC_DENY_FILE=/home/tyler/data/t/pr-scrub-work/private-deny.txt; out=$(make --no-print-directory check TMPDIR="$PWD/.scratch" 2>&1); rc=$?; printf "%s\n" "$out"; [ "$rc" -eq 0 ] \|\| exit "$rc"; printf "%s\n" "$out" \| grep "private-list=loaded" \| tail -n 1 \| grep . \|\| { echo "HOLD: the private list did not load"; exit 3; }'` rc=0 |
| Tool | `ship/tools/land.py` sha256 `7ad33759f7af8e0b…` from `/home/tyler/dev/helm` (informational) |
| Order | sha256 `2eb9209457f2e3e3…` (informational) |
| Foreign route | order-named preserve_paths `—` pinned — (the attestation post-conditions below refuse any mismatch); record `docs/governance/landing-attestations.md`. |

## Landing 12 — Re-seed the site from landing 19's deploy

| field | value |
|---|---|
| Landed | 2026-10-06 03:39:08 PDT by the lander using `ship/tools/land.py`, a pure **FAST-FORWARD**: main `dffc2280c7909c54f404d6fd456c95d0dc86a4aa` → `9c3a45ccce1d483bc7366841f54ff18570c8c94c`; NOT pushed (--no-push). The signed sha IS main; the landed tree equals the signed tree by identity. |
| The object | SIGNED `9c3a45ccce1d483bc7366841f54ff18570c8c94c`, tree `9e3f8ccb343a523685034c21a97932771eed31dd`, from `pr/site12` in `/home/tyler/data/t/pr-site12`, parent `dffc2280c7909c54f404d6fd456c95d0dc86a4aa`, governance `gov-aafbb6a10216` preserved. |
| Pre-checks under the lock | primary on main; HEAD == main == the named base; no remote measurement (--no-push); merge-base(main, candidate) == main and candidate != main; tree == the named tree; Helm-Audit-ID on every commit in base..candidate; tracked tree clean; object imported exact from the source. |
| Gate | `tools/land_gate.py 9c3a45ccc…` → rc=0, HONOURED-XO 9c3a45ccce1d483bc7366841f54ff18570c8c94c — the last record for this sha (store line 910) is XO-SIGNED. (store `/home/tyler/data/helm/tmp/fo-verdicts.tsv`) |
| Governance records | `9c3a45ccc` ← `gov-aafbb6a10216` (its trailer). Each record names the landed sha as the commit it governed. |
| Evidence before landing | `bash -c 'export PATH="$PATH:$HOME/.local/node/bin"; export PUBLIC_DENY_FILE=/home/tyler/data/t/pr-scrub-work/private-deny.txt; out=$(make --no-print-directory check TMPDIR="$PWD/.scratch" 2>&1); rc=$?; printf "%s\n" "$out"; [ "$rc" -eq 0 ] \|\| exit "$rc"; printf "%s\n" "$out" \| grep "private-list=loaded" \| tail -n 1 \| grep . \|\| { echo "HOLD: the private list did not load"; exit 3; }'` rc=0 |
| Tool | `ship/tools/land.py` sha256 `7ad33759f7af8e0b…` from `/home/tyler/dev/helm` (informational) |
| Order | sha256 `074531024fdd5aa6…` (informational) |
| Foreign route | order-named preserve_paths `—` pinned — (the attestation post-conditions below refuse any mismatch); record `docs/governance/landing-attestations.md`. |

## Landing 13 — Re-seed the site from landing 20's deploy

| field | value |
|---|---|
| Landed | 2026-10-06 10:30:28 PDT by the lander using `ship/tools/land.py`, a pure **FAST-FORWARD**: main `b8c568a8852abe8c7a4bf0123cb969ac02d94cd3` → `cf838158c48de326e1f994c2e7649c3e45c00cd2`; NOT pushed (--no-push). The signed sha IS main; the landed tree equals the signed tree by identity. |
| The object | SIGNED `cf838158c48de326e1f994c2e7649c3e45c00cd2`, tree `8a12faca5e1b0722091117e4b54605729a33c99f`, from `pr/site13` in `/home/tyler/data/t/pr-site13`, parent `b8c568a8852abe8c7a4bf0123cb969ac02d94cd3`, governance `gov-00752dc8423c` preserved. |
| Pre-checks under the lock | primary on main; HEAD == main == the named base; no remote measurement (--no-push); merge-base(main, candidate) == main and candidate != main; tree == the named tree; Helm-Audit-ID on every commit in base..candidate; tracked tree clean; object imported exact from the source. |
| Gate | `tools/land_gate.py cf838158c…` → rc=0, HONOURED-XO cf838158c48de326e1f994c2e7649c3e45c00cd2 — the last record for this sha (store line 918) is XO-SIGNED. (store `/home/tyler/data/helm/tmp/fo-verdicts.tsv`) |
| Governance records | `cf838158c` ← `gov-00752dc8423c` (its trailer). Each record names the landed sha as the commit it governed. |
| Evidence before landing | `bash -c 'export PATH="$PATH:$HOME/.local/node/bin"; export PUBLIC_DENY_FILE=/home/tyler/data/t/pr-scrub-work/private-deny.txt; out=$(make --no-print-directory check TMPDIR="$PWD/.scratch" 2>&1); rc=$?; printf "%s\n" "$out"; [ "$rc" -eq 0 ] \|\| exit "$rc"; printf "%s\n" "$out" \| grep "private-list=loaded" \| tail -n 1 \| grep . \|\| { echo "HOLD: the private list did not load"; exit 3; }'` rc=0 |
| Tool | `ship/tools/land.py` sha256 `7ad33759f7af8e0b…` from `/home/tyler/dev/helm` (informational) |
| Order | sha256 `9e7814b6d7e870a5…` (informational) |
| Foreign route | order-named preserve_paths `—` pinned — (the attestation post-conditions below refuse any mismatch); record `docs/governance/landing-attestations.md`. |

## Landing 14 — Re-seed the site from landing 22's deploy

| field | value |
|---|---|
| Landed | 2026-10-07 23:16:02 PDT by the lander using `ship/tools/land.py`, a pure **FAST-FORWARD**: main `34a772914a3e3885ae0c742174d5da87137534e1` → `6457ccd965a8e65cb23a51b17a774808fcfddcc1`; NOT pushed (--no-push). The signed sha IS main; the landed tree equals the signed tree by identity. |
| The object | SIGNED `6457ccd965a8e65cb23a51b17a774808fcfddcc1`, tree `af5975b5b816194f8b90a042bd8d022cc53acaed`, from `pr/site14` in `/home/tyler/data/t/pr-site14`, parent `34a772914a3e3885ae0c742174d5da87137534e1`, governance `gov-7c1b733ea404` preserved. |
| Pre-checks under the lock | primary on main; HEAD == main == the named base; no remote measurement (--no-push); merge-base(main, candidate) == main and candidate != main; tree == the named tree; Helm-Audit-ID on every commit in base..candidate; tracked tree clean; object imported exact from the source. |
| Gate | `tools/land_gate.py 6457ccd96…` → rc=0, HONOURED-XO 6457ccd965a8e65cb23a51b17a774808fcfddcc1 — the last record for this sha (store line 968) is XO-SIGNED. (store `/home/tyler/data/helm/tmp/fo-verdicts.tsv`) |
| Governance records | `6457ccd96` ← `gov-7c1b733ea404` (its trailer). Each record names the landed sha as the commit it governed. |
| Evidence before landing | `bash -c 'export PATH="$PATH:$HOME/.local/node/bin"; export PUBLIC_DENY_FILE=/home/tyler/data/t/pr-scrub-work/private-deny.txt; out=$(make --no-print-directory check TMPDIR="$PWD/.scratch" 2>&1); rc=$?; printf "%s\n" "$out"; [ "$rc" -eq 0 ] \|\| exit "$rc"; printf "%s\n" "$out" \| grep "private-list=loaded" \| tail -n 1 \| grep . \|\| { echo "HOLD: the private list did not load"; exit 3; }'` rc=0 |
| Tool | `ship/tools/land.py` sha256 `7ad33759f7af8e0b…` from `/home/tyler/dev/helm` (informational) |
| Order | sha256 `177e6fc9ca8520f8…` (informational) |
| Foreign route | order-named preserve_paths `—` pinned — (the attestation post-conditions below refuse any mismatch); record `docs/governance/landing-attestations.md`. |

## Landing 15 — Link the published PinkRobotics airships science mirror from the site README

| field | value |
|---|---|
| Landed | 2026-10-09 23:08:12 PDT by the lander using `ship/tools/land.py`, a pure **FAST-FORWARD**: main `b5ed952c8ea14bb671b9781ad4214d42cbb967c9` → `c44589a80de1b39f1736437ded3a7ecdac51281f`; NOT pushed (--no-push). The signed sha IS main; the landed tree equals the signed tree by identity. |
| The object | SIGNED `c44589a80de1b39f1736437ded3a7ecdac51281f`, tree `f4d9be21c664ea686de377987365c798704f1d06`, from branch `worker/cleanup-site-readme-seed-1009`, parent `5cdb2a88a148346bc53804e2d828edab98aa8b83`, governance `gov-0371b37ed438` preserved. Unit `robotics-cleanup-site-readme-seed-1009`. |
| Pre-checks under the lock | primary on main; HEAD == main == the named base; no remote measurement (--no-push); merge-base(main, candidate) == main and candidate != main; tree == the named tree; Helm-Audit-ID on every commit in base..candidate; tracked tree clean; object imported exact from the source. |
| Gate | `tools/land_gate.py c44589a80…` → rc=0, HONOURED-XO c44589a80de1b39f1736437ded3a7ecdac51281f — the last record for this sha (store line 1063) is XO-SIGNED. (store `fo-verdicts.tsv`) |
| Governance records | `e1139bdb3` ← `gov-ffe6619ec95c` (its trailer); `a1a5e6d69` ← `gov-75ae9f6d9628` (its trailer); `466ad4500` ← `gov-4b0207128380` (its trailer); `5cdb2a88a` ← `gov-91662ac1f11c` (its trailer); `c44589a80` ← `gov-0371b37ed438` (its trailer). Each record names the landed sha as the commit it governed. |
| Evidence before landing | `PYTHONDONTWRITEBYTECODE=1 make --no-print-directory check` rc=0 (environment PATH, TMPDIR set to host paths, not shown) (gate timeout 600 s, named by the order) |
| Tool | `ship/tools/land.py` sha256 `d74e14c13dcf0e27…` from helm (informational) |
| Order | sha256 `51ff42ed10d8b0b6…` (informational) |
| Foreign route | order-named preserve_paths `site/airships/data/live/fires.json, site/airships/data/live/heat.json, site/airships/data/live/perims.json` pinned — (the attestation post-conditions below refuse any mismatch); record `docs/governance/landing-attestations.md`. |

