# SAI web application (`app/`)

Angular 21 + PrimeNG 21 + Tailwind 4 application of **SAI — Systemic Agentic Interface** (same stack as `oip-web-frontend`). Three surfaces: **Workspace**, **Conversations**, **Supervisor**. The five backends are **mocked in the browser**, one port each: workspace manager, conversation manager, agent runtime (SAF harness lifecycle replayed with scripted agents, no model called), PIS IAM (Keycloak), model gateway (Azure AI Foundry).

## Run it

Requirements: Node 22.x, npm 10+.

```bash
npm ci
npm start            # http://127.0.0.1:4400
```

Walk the scenario: Workspace › Explorer (read the Feature, the manifests) → Conversations → "Use the scenario" → Start → acknowledge the AI notice → Confirm and launch → the run reaches the ★ Architecture Gate: a validation conversation opens and the bell notifies you → decide there (or in Supervisor) → read the accepted ADR in the explorer, with its history.

## Verify it

```bash
npm run typecheck    # tsc, app and spec projects
npm run test         # Vitest through the Angular builder
npm run build        # production build with budgets
npm run verify       # all of the above
npm run smoke        # headless Chrome walk of the journeys over dist/, screenshots in ../../evidence/smoke
npm run format       # Prettier (OIP settings)
```

`tools/smoke.mjs` needs Google Chrome on the machine and a built `dist/`; it adds no dependency.

## Regenerate the SAF package fixtures

```bash
python3 tools/import-saf-package.py --harness ../../saf-agentic-harness --organization ../../saf-agentic-organization
```

Requires PyYAML. Output: `src/assets/saf-package/*.json` (agents, workflows, model profiles, item types, **workspace structure map**, roles; see `NOTICE.md` there).

## Layout

```
src/app/core/domain            entities, lifecycles, notifications (no Angular)
src/app/core/ports             one port file per backend (workspace-manager, conversation-manager, agent-runtime, iam, model-gateway)
src/app/core/saf               harness contract mirrors, model-resolution rule, frontmatter and YAML readers
src/app/core/application       use cases, addressee rule, board derivation, workspace tree from the structure map, data tree
src/app/infrastructure         mock-world.ts (composition root) + one folder per mocked backend
src/app/state                  signal store (SaiStore)
src/app/features               pages: workspace (explorer, board, organization), conversations, supervisor (+ run detail)
src/app/shared                 artifact viewer, data tree, Markdown view, gate card, badges
src/sai-tokens.css             design tokens (OIP names, indigo primary, ★ gate and AI accents)
src/assets/saf-package         fixtures generated from the SAF repositories
tools/                         fixture generator, smoke test
```

## What is real and what is mocked

| Real | Mocked |
| --- | --- |
| Domain rules and lifecycles (oap#1), addressee rule, participant and tenant isolation, gate role checks, validation conversations and notifications | identities and tenants (fictitious, "acting as" switch) |
| Harness lifecycle order, log-entry contract, one validated write per commit, commit-gate rejection and retry, model resolution over the real catalog, budget stop, cancellation | step execution and artifact bodies (scripted texts) |
| SAF package content (agents, workflows, weights, statuses, model profiles, **workspace structure map**, roles) generated from the repositories | Copilot dispatcher, scopes, gates, launch inputs (declared by SAI pending saf#6 SF15) |
| Views rebuilt from workspace state and history | persistence (in memory, lost on reload); model deployments (fictitious EU data-zone names) |

`public/runtime-config.js` carries `backends: 'mock' | 'live'` and one URL per backend for the day the adapters exist.
