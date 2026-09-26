# Foundations — Pink Robotics

- **Repo**: ~/dev/pinkrobotics — the carved private repo (fresh root `83b3c4f`, seeded from
  the estate repository). Carve decisions, history and the personal-content evidence:
  `docs/working/26-09-25-pinkrobotics-carve.md` in the helm repo (mission
  project-foundations-0925 p1).
- **Substrate project**: `prj-pinkrobotics` in the live helm store (`helm project show
  prj-pinkrobotics`). This repo's adoption binding points at it; governance hooks are
  installed, so `helm commit analyze → approve → git commit` lands its audit in THIS
  project's graph, never in prj-helm.
- **How to land here**: `git add …` then `python3 -m helm.cli commit run` (or the manual
  analyze → approve chain). Never `--no-verify`.
- **Hard rules**: nothing public from this repo; deploys stay sourced from pink-sites until
  the cutover unit (p1 decision 4); airships manifest drift must be ported before the next
  `publish.py` run (p1 decision 3). Full rules: `AGENTS.md` here.

*(Seed written by p2 — the governance-installation proof commit. The full FOUNDATIONS.md
— deploy, test commands, the complete rule set — is mission acceptance item 7, a later
piece of project-foundations-0925.)*
