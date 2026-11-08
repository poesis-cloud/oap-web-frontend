# OAP Web Frontend — testing strategy (slice 1)

## Levels

| Level | Tool | Scope | Where |
| --- | --- | --- | --- |
| Contract | Vitest | harness log-entry contract validator, instance id mint, model-resolution rule against the specification's worked examples, SAF path patterns, YAML subset reader, data tree | `core/saf/*.spec.ts`, `core/application/board.spec.ts`, `core/application/data-tree.spec.ts` |
| Analysis and organization view | Vitest | cost in euros from usage records and the gateway price list, durations and human wait, first-pass flag, subjects across workflows and runs, workflow summaries (cost per accepted artifact), formats; organization categories, folder tree order, history and gap to nominal | `core/application/analysis.spec.ts`, `core/application/organization-view.spec.ts` |
| Domain | Vitest | lifecycles (allowed and refused transitions), addressee rule, workspace tree from the structure map | `core/domain/*.spec.ts`, `core/application/dispatch.spec.ts`, `core/application/workspace-tree.spec.ts` |
| Application scenario | Vitest | the vertical slice end to end on the mocked backends: proposal, confirmation, run, commit-gate revert, journal validity, **gate → validation conversation → invitations and notifications → decision closes it**, rejection and rework, acceptance, board statuses, cost per accepted artifact vs usage, history rebuild, cancellation, budget stop, tenant isolation, no free chat, consultations, archive | `infrastructure/mock-world.spec.ts` |
| Type and template | `tsc --noEmit`, Angular strict templates | whole project | `npm run typecheck`, `ng build` |
| Visual / journeys | `tools/smoke.mjs` (headless Chrome over `dist/`, no dependency; `--dist` and `--base` for a sub-path build) | J4 explorer and previews, J1 launch, J3 gate → gate conversation → reject → rework → Supervisor leads to the second gate conversation → approve there, J2 run detail with cost and time, J4 board and ADR history, J7 Organization (overview, agents, workflows, browse an agent file and the workspace map, history), J8 Supervisor runs and analysis, J5 consultation, J6 out of scope, phone widths | `../../evidence/smoke/` (34 screenshots, `report.json`) |

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

## Results on 2026-11-08 (night, workstation, Node 22.21.1, OIP stack)

- `tsc` app and spec: PASS, 0 errors.
- `ng test` (Vitest): 12 files, 55 tests, PASS.
- `ng build` (production): PASS; initial bundle 960 kB raw / 209 kB transferred, within the budgets of ADR-006 (the organization sources, 853 kB, are a fetched asset, not part of the bundle).
- `tools/smoke.mjs`: 12 steps PASS, 34 screenshots, 0 console error.
- Clean install from the lock file (`npm ci` in an empty folder, `.npmrc` with `legacy-peer-deps`): PASS, 493 packages; production build on that install: see `../../evidence/` (CI simulation).
- `def/ci/preview.yaml` (to move to `.github/workflows/` with a `workflow`-scoped token) runs the same type check, tests and build on every push of the branch `Nicolas`.

Earlier in the evening (three surfaces): 10 files, 44 tests; 944 kB / 205 kB; 11 steps, 26 screenshots.
