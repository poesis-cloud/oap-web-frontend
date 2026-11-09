# OAP Web Frontend — testing strategy (slice 1)

## Levels

| Level | Tool | Scope | Where |
| --- | --- | --- | --- |
| Contract | Vitest | harness log-entry contract validator, instance id mint, model-resolution rule against the specification's worked examples, SAF path patterns, YAML subset reader, data tree | `core/saf/*.spec.ts`, `core/application/board.spec.ts`, `core/application/data-tree.spec.ts` |
| Explorer and diff | Vitest | directory listing like GitHub (folders first, expected slots last, breadcrumbs, file counts), line diff (additions, removals, folded context) | `core/application/explorer.spec.ts`, `core/application/diff.spec.ts` |
| Analysis and organization view | Vitest | cost in euros from usage records and the gateway price list, durations and human wait, first-pass flag, subjects across workflows and runs, workflow summaries (cost per accepted artifact), formats; organization categories, folder tree order, history and gap to nominal | `core/application/analysis.spec.ts`, `core/application/organization-view.spec.ts` |
| Domain | Vitest | lifecycles (allowed and refused transitions), addressee rule, workspace tree from the structure map | `core/domain/*.spec.ts`, `core/application/dispatch.spec.ts`, `core/application/workspace-tree.spec.ts` |
| Application scenario | Vitest | the vertical slice end to end on the mocked backends: proposal, confirmation, run, commit-gate revert, journal validity, **the ★ gate as the orchestrator's message in the launching conversation, holders invited and notified there, decided there**, **one conversation per worker session** (opening, reverts, delivery, scoped answers), rejection and rework, acceptance, board statuses, cost per accepted artifact vs usage, history rebuild, cancellation, budget stop, tenant isolation, no free chat, consultations, archive | `infrastructure/mock-world.spec.ts` |
| Type and template | `tsc --noEmit`, Angular strict templates | whole project | `npm run typecheck`, `ng build` |
| Visual / journeys | `tools/smoke.mjs` (headless Chrome over `dist/`, no dependency; `--dist` and `--base` for a sub-path build) | explorer like GitHub (tree, directories, viewer over the listing, versions, raw, organization YAML), conversation as a chat (new, proposal, launch), the gate journey (raised, notified, artifact reviewed in the viewer, rejected in its conversation; Supervision › Gates → second gate → approved), runs (list, statistics, run, session, log), board and organization, consultation and out-of-scope, tablet and phone, light theme | `../../evidence/smoke/` (38 screenshots, `report.json`) |

## Acceptance traceability

Tests name the acceptance criteria they exercise (`F1-AC3`, `S7-AC2`, `F17-AC7`, `S22`, …). They cover rules, not pixels: a passing suite proves the core honours the specification's invariants on the mocked backends; it proves nothing about harness value (R13).

## Running

```bash
npm run typecheck   # tsc on app and spec configs
npm run test        # ng test (Vitest runner)
npm run build       # production build with budgets
npm run verify      # all three
npm run smoke       # needs Google Chrome and a built dist/
```

Direct Vitest invocation, useful on a constrained machine: `./node_modules/.bin/vitest run --root . --dir src --environment node`.

## Results on 2026-11-09 (night: F16 learning loop, decision dialogue, small-screen navigation)

- `tsc` app and spec: PASS, 0 errors.
- `ng test` (Vitest): 16 files, 74 tests, PASS (incl. `improvement.spec.ts`: capture, retrospective threads, atomic apply, rollback, snapshot pinning, stale approval, rejection sessions, workspace creation; the decision message and the orchestrator's answer; the gap to nominal by content).
- `ng build` (production): PASS; initial bundle 1.02 MB raw / 222 kB transferred.
- `tools/smoke.mjs`: **14 steps PASS, 54 screenshots, 0 console error**: seeded gates, explorer under `portfolio/`, launch, gate rejected then approved (two gates waiting: the flow is found by its run instance), runs and sessions, board and organization, consultation and out-of-scope, **phone and tablet navigation** (sections sheet from the bar, the crumbs and the rail; sessions and tree sheets; account menu), light theme, Improvement (evidence, retrospective thread, returned conclusion), organization change (diff, scorecard, approval, one file changed), rollback (identical to the package again), Agentic Organizations (isolated workspace).
- Two defects found by the walk and fixed: `InMemoryWorkspace.commits()` returned its mutable array (Angular `computed` views never saw new commits); `gapToNominal` counted paths touched instead of content (a rollback never closed the gap).

## Results on 2026-11-09 (evening: Poesis identity, sessions as conversations, seeded scenario)

- `tsc` app and spec: PASS, 0 errors.
- `ng test` (Vitest): 15 files, 64 tests, PASS (incl. the gate as the orchestrator's message in the launching conversation, and one conversation per worker session).
- `ng build` (production): PASS; initial bundle 975 kB raw / 212 kB transferred (system fonts, no webfont).
- `tools/smoke.mjs`: 9 steps PASS, 39 screenshots (desktop, tablet, phone, light theme), 0 console error; the walk starts on the seeded history (one run completed, one waiting at its gate).
- Keyed preview bundle built from the same sources.

## Results on 2026-11-09 (redesign, workstation, Node 22.21.1, OIP stack)

- `tsc` app and spec: PASS, 0 errors.
- `ng test` (Vitest): 15 files, 63 tests, PASS (explorer listing, line diff, analysis, organization view, price list, contracts, lifecycles, scenario).
- `ng build` (production): PASS; initial bundle 970 kB raw / 211 kB transferred, within the budgets of ADR-006 (organization sources fetched, not bundled).
- `tools/smoke.mjs`: 9 steps PASS, 38 screenshots (desktop, tablet, phone, light theme), 0 console error.
- Keyed preview bundle (`--base-href /<key>/`, hash routing) built from the same sources for the team preview.

## Results on 2026-11-08 (night, four surfaces)

- `tsc` PASS; Vitest 13 files, 57 tests; build 965 kB / 210 kB; smoke 12 steps, 34 screenshots; clean install 493 packages; GitHub run `oap-frontend-preview` 42522945656: success.
