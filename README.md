# Pink Robotics

The source of pinkrobotics.ca: working-animal technology, the airships research
program, energy, and the published research behind them.

| path | what it is |
| ---- | ---------- |
| `site/` | the served website, exactly as deployed (static, no build step) |
| `site/airships/` | the airships pages and fleet monitor, **published into here** from the separate airships repository by its `tools/publish.py` |
| `site/airships/data/live/` | the live wildfire mirror — deployment state written on the server, never source |

Repository documents (this README, `AGENTS.md`) live outside `site/` so they are never served.

Status: private. The site is still deployed from the estate repository it was carved from; see
`AGENTS.md` for the source-of-truth rule until the deploy moves here.
