---
helm_managed: true
managed_doc_id: mgd-26.269.028
primary_entity: project
source_path: FOUNDATIONS.md
last_ingested_at: 2026-09-26T16:33:13.589560Z
last_source_content_hash: fbe98c2a729d2404c5d00e592fa9ef597c9d8e2c061dfb03936ad9ad76c3ad5e
unresolved_conflicts: 0
unresolved_partials: 0
unresolved_stale: 0
helm_managed_keys:
  - helm_managed
  - managed_doc_id
  - primary_entity
  - source_path
  - last_ingested_at
  - last_source_content_hash
  - unresolved_conflicts
  - unresolved_partials
  - unresolved_stale
  - claims
claims:
  - ingest_key: 854b7d1a6bc45fed27765c8d8fa729d5db579c91909f806111614542c51ef75a
    claim_id: clm-26.269.031
    kind: policy
    verdict: intent
    link_match_mode: any
    acceptance_state: open
    substrate_links: []
    source_span: "§4"
  - ingest_key: 6dd2965a4deac88ec0b000897c62a7acf24d1efde027e3f2302c6cbf84c993e1
    claim_id: clm-26.269.033
    kind: policy
    verdict: intent
    link_match_mode: any
    acceptance_state: open
    substrate_links: []
    source_span: "§4"
  - ingest_key: 6b3a5fc737e5cf4aaff0c4a7de012e9e4f8d083b2e9c2aa3536b5be8340ad91d
    claim_id: clm-26.269.035
    kind: policy
    verdict: intent
    link_match_mode: any
    acceptance_state: open
    substrate_links: []
    source_span: "§3"
  - ingest_key: c54f7229cfc755a6a24ad0d6277756138721ec60bc72fa30f5c3098ccf0718a6
    claim_id: clm-26.269.037
    kind: framing
    verdict: intent
    link_match_mode: any
    acceptance_state: open
    substrate_links: []
    source_span: "§2"
  - ingest_key: ec65b3dd8cd3643dffb02b88ab5a0b8eed157e1bb860c17ee65b794c3ac052e5
    claim_id: clm-26.269.039
    kind: purpose
    verdict: intent
    link_match_mode: any
    acceptance_state: open
    substrate_links: []
    source_span: "§1"
human_nodes: []
---
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

---

## Helm-managed: Inconsistencies

*This section is helm-managed. Do not edit by hand; edits will be overwritten on re-ingestion. To accept a contested claim intentionally: `helm ingest accept <claim-id> --rationale ...`*

### Open

- **[goal]** Complete the full FOUNDATIONS.md (deploy, test commands, complete rule set) as mission acceptance item 7 of project-foundations-0925.
  - Verdict: `intent` — Active but not yet substrate-grounded.
  - Horizon: milestone
  - Success criteria: FOUNDATIONS.md includes deploy commands, test commands, and the complete rule set.
  - To resolve: Add substrate-grounding evidence (decision/assumption/artifact whose `files` overlap this goal's), then `helm ingest --reverify`.
  - Goal id: `gol-26.269.041`

### Resolved

(none yet)

### Accepted by author

(none yet)

### Stale (substrate evidence has been archived)

(none yet — entries appear here when a Claim's `substrate_links` all archive without re-verification, indicating the Claim is awaiting `helm ingest --reverify`.)
