# N.E.K.O.-DramaticWriting

[中文](README_CN.md)

N.E.K.O.-DramaticWriting is the standalone authoring workspace for N.E.K.O Theater `neko.story.numeric.v2` packages.

The headless core is now available in N.E.K.O's `services/theater_workshop/sdk/`. This repository retains its web UI, Flask API and model settings, and shared writing and review rules continue to be synchronized. It has not been frozen or converted into an SDK adapter. The embedded SDK does not require this web service or its settings page. See the [generator design](docs/superpowers/specs/2026-08-06-neko-theater-numeric-v2-generator-design.md) and [SDK integration guide](../N.E.K.O/services/theater_workshop/README.md).

New generation builds a story frame, writes each scene and extracts its opening states, then creates one Normal ending. Each phase saves a resumable checkpoint; legacy whole-outline checkpoints retain their original protocol. The complete draft must pass the current N.E.K.O compiler before replacing the live map. Authors can then use an endpoint-first branch wizard on the Story Map: choose the exact mainline scene to rejoin, an existing ending, or confirm a new ending first, and let the model work backward into a one-to-three-scene path. The default UI uses human-readable trigger semantics and does not require authors to calculate hidden thresholds; raw conditions remain available in advanced editing. Node enhancement is a separate explicit model action and never edits routes. Mainline quality assessment is off by default and runs only after the author clicks the assessment action.

## Product boundary

- Mainline generation and quality assessment are separate. Generation handles the outline and deterministic structure closure without automatically scoring or rewriting by score.
- Metrics are authored on the Story Map, not generated with the mainline. Branch thresholds, complements, and priority are derived deterministically from the semantic state selected by the author.
- A new ending is generated and confirmed before its path is generated; branch generation is not scored automatically.
- Explicit assessment partitions fact checks by node and task, checks exit evidence and contract coverage, reviews cited evidence when issues exist, scores literary sections, and reviews executable repair plans. Each stage receives its relevant facts and shared runtime rules; literary scoring does not treat editor state or turn budgets as literary quality.
- Explicit assessment covers characterization, plot, theme, prose style, pacing, and emotional resonance across the complete story. Each dimension is scored out of 100 and fails below 75. Final dialogue and real player response are assessed only as design potential.
- The report includes a six-axis radar chart, metric-count recommendations for adding, removing, or merging metrics, and relationship optimization advice. It does not directly change numeric thresholds.
- Assessment stores a report and node-specific modification plans without changing the Story Package. After assessment, the Story Map highlights every suggestion that can be applied to one existing node. Clicking a highlighted node asks for confirmation; either answer clears all highlights, while “yes” combines that node's quality issues and relationship advice into one targeted model call after checking that the report, evidence, repair plan and field permissions are valid.
- Structural plans that add, delete, or reconnect nodes, routes, or conditions remain visible as manual recommendations and cannot be accepted for automatic optimization.
- Targeted node optimization cannot edit IDs, node types, routes, metrics, thresholds, priority, or turn budgets. The previous report becomes stale afterward and must be explicitly rerun.
- Draft generation never mutates the live map. Apply revalidates the revision, context, and current N.E.K.O compile result before one atomic commit.
- Every non-ending node defaults to the short-story budget `min_turns=3 / recommended_turns=3`; authors can choose the recommended closure turns per scene in the Story Map node inspector, with 3 as the default. Generation prompts target eight turns per scene and ask for a targeted rewrite when a short scene exceeds that target. Model-declared `expected_turns` remains author-side pacing diagnostics only and never changes the Runtime recommendation; observer-only exits are surfaced to authors for revision.
- New metrics default to the `0–50` range, with preset state bands starting at `20` and `35` so short-story branches can become reachable earlier.
- `recommended_turns` is player-hidden soft pacing guidance. It guides Actor focus and closure but never limits player input or forces routing.
- All metrics are hidden from players.
- Compile reports deterministic contract errors from the N.E.K.O Numeric v2.2 compiler.
- Export and install require the current project revision to pass N.E.K.O validation.
- Model settings persist in a user-level file outside the repository.

New project-specific environment variables use the `NEKO_NUMERIC_DRAMA_*` prefix. Legacy `INKAI_*`
variables and the old settings directory remain read-compatible so existing local configuration is not lost;
the renamed application keeps the `NEKO_Numeric_drama` settings directory and existing project directory without automatically moving or rewriting user data.

Shared writing, state projection, fact and exit contracts, evidence, literary review and bounded repair rules are synchronized from N.E.K.O’s `services/theater_workshop/sdk/`. The UI, Flask API, model settings and subprocess compiler bridge remain independent. Token budgets use the same `o200k_base` encoding as N.E.K.O.

## Setup and run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python start_web.py
```

Open `http://localhost:5000/`.

## Main API

```text
GET  /api/theater/numeric-v2/metric-presets
GET  /api/theater/numeric-v2/projects
POST /api/theater/numeric-v2/projects
POST /api/theater/numeric-v2/projects/{project_id}/generate
PATCH /api/theater/numeric-v2/projects/{project_id}
POST /api/theater/numeric-v2/projects/{project_id}/quality-assessment
POST /api/theater/numeric-v2/projects/{project_id}/quality-nodes/{node_id}/optimize
POST /api/theater/numeric-v2/projects/{project_id}/nodes/{node_id}/enhance
GET  /api/theater/numeric-v2/projects/{project_id}/nodes/{node_id}/branch-options
PUT  /api/theater/numeric-v2/projects/{project_id}/mainline-order
POST /api/theater/numeric-v2/projects/{project_id}/branch-ending-drafts
POST /api/theater/numeric-v2/projects/{project_id}/branch-drafts
GET  /api/theater/numeric-v2/projects/{project_id}/branch-drafts/{draft_id}
POST /api/theater/numeric-v2/projects/{project_id}/branch-drafts/{draft_id}/apply
POST /api/theater/numeric-v2/projects/{project_id}/compile
POST /api/theater/numeric-v2/projects/{project_id}/validate-neko
GET  /api/theater/numeric-v2/projects/{project_id}/export
POST /api/theater/numeric-v2/projects/{project_id}/install
```

Model settings:

```text
GET /api/settings/model
PUT /api/settings/model
```

The API key is never returned by the read endpoint or written into a Story Package.

## Verification

```bash
PYTHONPATH=. .venv/bin/python -m pytest -q \
  tests/theater_generator/test_numeric_v2.py \
  tests/theater_generator/test_numeric_v2_generation.py \
  tests/theater_generator/test_staged_generation.py \
  tests/theater_generator/test_staged_api.py \
  tests/theater_generator/test_numeric_v2_branch.py \
  tests/theater_generator/test_numeric_v2_api.py \
  tests/theater_generator/test_numeric_v2_project_store.py \
  tests/theater_generator/test_numeric_v2_frontend.py \
  tests/theater_generator/test_imports.py

PYTHONPATH=. .venv/bin/python -m py_compile \
  theater_generator/api.py \
  theater_generator/generation/numeric_v2.py \
  theater_generator/generation/quality.py \
  theater_generator/numeric_v2.py \
  theater_generator/numeric_v2_branch.py \
  theater_generator/numeric_v2_project_store.py \
  start_web.py
```
