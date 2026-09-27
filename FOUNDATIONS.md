# Foundations — Pink Robotics: how to direct the ship here

Written by mission project-foundations-0925 (the foundations builder, 2026-09-27). The next mission — Pink Robotics public, with
autonomous development — starts from this file. It replaces the p2 seed of 2026-09-26.

## Repository and project
- **Repository:** `~/dev/pinkrobotics`, the carved private repo (fresh root `83b3c4f`, seeded from the estate repository; the carve
  decisions, history choice and personal-content evidence are `docs/working/26-09-25-pinkrobotics-carve.md` in the helm repo).
  It has **no `origin` yet**: the GitHub home needs the Admiral's hand (rename `pinkai-ca/pinkrobotics` → `pink-sites`, repoint the
  estate's remote, create a PRIVATE `pinkai-ca/pinkrobotics`, push `main`). Until then every landing here is local-only (`--no-push`).
- **Substrate project:** `prj-pinkrobotics` (`helm project show prj-pinkrobotics`). The primary is bound; a worktree or local clone of it
  inherits the binding once helm landing foundations-finish-0927 is on main, so `helm commit run --worktree <checkout>` writes its audit
  into prj-pinkrobotics and never into prj-helm. Before that landing, bind a checkout explicitly: `helm project bind <checkout>
  prj-pinkrobotics --yes`.
- **Governance:** the helm hooks are installed in `.git/hooks`; every commit is `helm commit run`, never `--no-verify`.
  `.claude/settings.json` (the helm-owned Claude hooks) is tracked and carries this machine's absolute paths, committed by the 09-26
  install. The public mission must untrack it: a landing that deletes a tracked file deletes it from the primary's working tree, so
  untrack it and re-run `helm install --project prj-pinkrobotics` in the same step.

## Directing the ship here
1. **Work order:** `python3 ship/tools/workorder.py define --id <id> --repo /home/tyler/dev/pinkrobotics --title … --goal … --acceptance …`.
2. **Worker:** `python3 ship/tools/bridge_up.py cell <harness> worker <name> --repo /home/tyler/dev/pinkrobotics --model … --effort …`
   (the orchestrator's `place` passes `--repo` itself). The seat's working directory is a clone of this repo at `main`'s tip; the ship
   tree is `<workspace>.helm` (SHIP_HELM); its `.ship/` outbox lives in the working directory.
3. **Governed commits:** `git add …` then `helm commit run --worktree <checkout> -F <message file>`.
4. **Review:** `tools/review.py --codex --claude --candidate <sha> --evidence-round r1 --json --workdir <checkout>`; documents need no
   round (law I.3d.1). The honoured record is the round's PASS (`tools/fo_verdict.py`) or the XO's XO-SIGNED for the exact sha.
5. **Landing order** (Boyce, the CO principal or the Admiral's own seat), the first landing with `--attest-init`:
   `python3 ship/tools/submit.py --to boyce --kind order --body "<the word>" --landing <candidate> <tree> <base> --attest-path
   docs/governance/landing-attestations.md --test-arg /home/tyler/.local/node/bin/node --test-arg=--test
   --test-arg site/airship3d/tests/control.test.mjs`
6. **Land:** `python3 ship/tools/land.py --order <id> --repo /home/tyler/dev/pinkrobotics --source <checkout> --branch <branch> --no-push
   --preflight`, then the same line without `--preflight`: fast-forward, one attestation child in `docs/governance/landing-attestations.md`
   (the landing numbers live there). Drop `--no-push` once `origin` exists.
7. **Deploy:** the live site is still deployed from the estate repository (`~/dev/pink-sites`: `./deploy.sh pinkrobotics --dry-run`, then
   without `--dry-run`), which also receives every writer (airships `publish.py`, the design and figure tools, the live-fire mirror timer).
   Until the cutover unit repoints those writers at `site/` here, edit the site there and re-seed here (the rule and commands are in
   `AGENTS.md`). There is no deploy from this repo yet.

## Test commands
- **Landing gate:** `~/.local/node/bin/node --test site/airship3d/tests/control.test.mjs` — 22/22 at `6f49e8d` on 2026-09-27, 0.14 s.
- **Wide set:** `~/.local/node/bin/node --test site/airship3d/tests/` — 97 pass / 4 fail on the same tree; the four are the class-scaling
  family, the selectable-node metadata, the performance budget and the mission-cycle physical consistency. Fix them before naming the
  wide set as the gate. The site itself is static and has no build step.

## Hard rules
- Nothing from this repository is public until the public mission, on the Admiral's word. Never commit personal documents, private
  reports or anything from the other estate sites (`AGENTS.md`).
- Airships is its own repository (Apache-2.0): `site/airships/` is its published copy; fix source there and publish, never hand-edit the
  copy. `publish.py --check` showed 14 files drifted by estate edits since 2026-08-15: port them before the next publish or they are lost.
- For the public mission: the helm mirrors in the tree — `docs/helm/ingested/` (substrate) and `docs/governance/landing-attestations.md`
  (landing records name local paths and seats) — are the ship's bookkeeping; decide whether they stay in a public tree. `site/airships/cell/`
  is basic-auth gated on the live site.
- Scratch never in /tmp; `/mnt/24TB-A` and `-B` are full.

## Harness matrix (2026-09-27; probe commits on `probe/foundations-0927-<harness>`, never landed)
| harness | cell | receipt |
|---|---|---|
| codex gpt-6-sol | PASS | `c32390da0`, audit gov-4bd031f6ee1e in prj-pinkrobotics; codex session 01a0e365-2ff9-7f53-a9d7-f5bafb8d2d8d (the 09-26 cell `289aacee` had written its audit into prj-helm) |
| claude fable-5.1 | PASS | `964c5dac4`, audit gov-63f4cd6d81b8 in prj-pinkrobotics; claude session 15fd414b-6a7d-4bf6-b675-05c5424f78bb |
| muse spark-1.3 | HOLD | headless `muse exec` (1.4.0) opened the repo, staged the probe file and then waited on an approval for the shell step (`helm commit run`) in an untrusted workspace until the 600 s timeout, on both repos (sessions 01a0e36a-570a-7443-9bac-c851228d19be, 01a0e36a-6d25-74e2-a1cb-636099d728dd); a minted muse seat carries the ship's permission seed, so the cell waits on the boot-identity repair Engineering owns |
| glm 5.3 | HOLD | glm-primary at 99 % of its week; next attempt after the reset, 2026-10-01 02:40 UTC |
| grok 4.7 | HOLD | grok-primary at 99 % of its week; next attempt after the reset, 2026-09-29 20:41 UTC |
| local qwen/opencode | HOLD | no tool-capable governed job is qualified; not a command harness |
