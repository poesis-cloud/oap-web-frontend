# SAI Web Frontend — SAF integration boundary (2026-11-08)

How the frontend relates to the Systemic Agentic Framework, what it reuses, what it waits for, and what slice 1 simulates. Companion of ADR-004 and ADR-005.

## What SAF provides (verified in the repositories on 2026-11-08)

| SAF product | Version seen | What SAI uses |
| --- | --- | --- |
| `saf-agentic-harness` (Apache-2.0) | `v1.0.0-beta.1` lineage (`8ea39c4`) | the twelve-function contract, the report/context/log-entry schemas, the model-resolution rule, the "1 validated write = 1 commit" workspace semantics |
| `saf-agentic-organization` (Apache-2.0) | `v0.1.0-78-g318d30a` | 14 agents, 20 workflows (portfolio, program, team), per-step capability weights, 9 trackable artifact kinds with statuses, the 20-profile model catalog, artifact templates |
| `saf-agentic-workspace` (Apache-2.0) | 12 commits, docs in construction | the workspace concept (HEAD = state); installer and pipelines (SF14) not yet available |

The harness today binds to one host, VS Code with GitHub Copilot Chat (hooks). The **SAI host adapter** (headless, multi-tenant, workspace-scoped) is saf#6 **SF1** and is not groomed. The run-state and cost events SAI's views should read are **SF4**, also not groomed. The "SAI interaction contract" (dispatcher, scopes, gates, inputs, item types) is **SF15**, not groomed.

## Mapping of harness functions to what SAI shows

| # | Harness function | Where it appears in SAI |
| --- | --- | --- |
| 0 | `start-session` | run detail: step session id; journal |
| 1–2 | `resolve-workflow-instructions`, `resolve-workflow-skills` | journal (orchestrator session) |
| 3 | `resolve-step` | step order on the run detail; `no-next-step` precedes the ★ gate |
| 4 | `resolve-step-model` | model profile, score, cost rank and reason on each step; usage record model |
| 5 | `check-step-preconditions` | step verdicts |
| 6–7 | `resolve-step-instructions`, `resolve-step-skills` | journal |
| 8 | `check-step-authorization` | step verdicts |
| 9 | `check-step-artifact` | commit gate: `valid` creates the artifact version; `reverted` is shown with its reason and the retry |
| 10 | `check-step-postconditions` | step delivered |
| 11 | `end-session` | session closed; no entry may follow (C8) |

The ★ gate is **not** a harness function: the harness places the human checkpoint at the workflow return boundary (spec, function 3, invariant 7). SAI models the gate as a human decision recorded in the workspace (F4-R3, F5-R1); the demo runtime commits it as a validated write. How SF4 will encode gate events is open.

## What slice 1 simulates, and how it is labelled

| Simulated | Real | Label in the UI |
| --- | --- | --- |
| Agent answers in conversations (scripted) | addressee rule, participation, thread mechanics, proposals | AI badge + provenance `demo-scripted`, `model: none (scripted)` |
| Step execution and artifact bodies (scripted) | lifecycle order, one commit per validated write, journal entries valid against the log-entry contract, commit-gate rejection and retry, model resolution over the real catalog, budget stop, cancellation | "Demo runtime" note in the rail, "No model was called in this build" on the run detail |
| Run record `runs/<id>.run.json` in the workspace | the principle that views rebuild from workspace state and history | run detail footnotes |
| Gates, dispatcher, scopes, inputs declared by SAI | the SAF package itself (agents, workflows, weights, statuses, catalog) generated from the repositories | "declared by SAI pending SF15" |

## Recommended next steps towards the real integration

1. Groom SF1 with the SAF owners: a headless adapter taking `FRAMEWORK_DIR` and a per-workspace `FRAMEWORK_WORKSPACE_DIR`, exposing the twelve commands over a process boundary owned by `oap-agent-runtime`.
2. Produce real harness fixtures: run the Python harness (`.tools/saf-venv` on the workstation) over a temporary git workspace for `architectural-runway-extension`, record `resolve-step`, `resolve-step-model` and `check-step-artifact` reports, and replay them in the demo runtime instead of the TypeScript port (then delete `core/saf/model-resolution.ts`).
3. Define SF4 events with the SAF owners so that `runs/<id>.run.json` disappears in favour of workspace-history events.
4. Replace the SAI-side declarations of `package-loader.ts` by SF15 once the package declares them.

## Addendum 2026-11-08 (evening): workspace structure map and roles

The fixture generator now also exports `conf/workspace.conf.yaml` (the recursive map of `folder` and `artifact` nodes with `<placeholder>` slugs) as `workspace-structure.json`, and the roles of `conf/access-control-list.conf.yaml` as `roles.json`. The explorer lays the paths at HEAD on that map (`core/application/workspace-tree.ts`); required slots without a file are shown as expected. Reading choice to confirm with SAF: the single root node `portfolio` ("Workspace root folder") is treated as the workspace itself, because the artifact schemas declare `pathPatterns` without that segment (`art/*/program-backlog/*/*.adr.md`). Raised in `POESIS-SAI/issues-drafts/saf-6-comment.md`.
