---
id: SAI-FE-ADR-004
title: Reuse of SAF contracts in the frontend, without rebuilding SAF
status: proposed
product: oap-web-frontend
decision_scope: which SAF artifacts the frontend mirrors, generates or implements
deciders:
  - Clément Cazaud (maintainer)
consulted:
  - SAF owners (saf-agentic-harness, saf-agentic-organization)
created: 2026-11-08
decided: null
---

# SAI-FE-ADR-004 — SAF contracts in the frontend

## Context
Every run is a SAF organization executed by the SAF harness (poesis#40 R3). SAI reads runs, journals and artifacts from the hosted workspace and must present them in their native format (F5-R9). SAI must not rebuild a second SAF, yet slice 1 has no hosted harness to call (saf#6 SF1 is not groomed).

## Decision
Three levels of reuse, each kept explicit:

1. **Mirror, never redefine**: TypeScript types of the harness contracts (report envelope, context, the twelve functions, log entry) in `core/saf/contracts.ts`, with a validator used by the demo repository and by tests. Source: `saf-agentic-harness/contracts/*.schema.json` and `def/core/spec.md`.
2. **Generate, never hand-copy**: the organization package the demo loads (agents, workflows with steps and capability weights, model profile catalog, item types with statuses) is generated from the SAF repositories by `tools/import-saf-package.py` into `src/assets/saf-package/*.json`, with the source commit recorded. Regenerate when the package changes.
3. **Port one rule for the demo only**: the `resolve-step-model` scoring rule (weighted capability sum, cost-rank tie-break, slug tie-break) is implemented in `core/saf/model-resolution.ts` so that the demo runtime routes deterministically over the real catalog. It is tested against the specification's worked examples. In production the harness alone resolves models (F4-R8); the frontend displays the journaled result and never re-routes.

What SAF does not declare yet (the Copilot dispatcher, consultation scopes, ★ gates with holder roles and rework step, launch inputs) is declared by SAI in `package-loader.ts` and labelled "pending SF15" in the UI and the docs.

## Consequences
- When saf#6 SF15 lands, delete the SAI-side declarations and read them from the package.
- When SF1/SF4 land, the demo runtime's run record (`runs/<id>.run.json`) is replaced by the SAF run-state and cost events read from the workspace history.
- Licence: the generated fixtures derive from Apache-2.0 material; `NOTICE` must credit Poesis Cloud and contributors when the repository is published.

## Implementation hooks
`app/tools/import-saf-package.py`, `app/src/assets/saf-package/`, `app/src/app/core/saf/`, `app/src/app/infrastructure/demo/package-loader.ts`.
