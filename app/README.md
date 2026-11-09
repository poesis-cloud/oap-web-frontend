# OAP web application (`app/`)

Angular 21 + PrimeNG 21 + Tailwind 4 application of the **Organization Agentic Platform** (same stack as `oip-web-frontend`), standing for the **Specialized configuration serving the SAFe Agentic Organization**. One menu: **Workspace** (Explorer, Board), **Conversation**, **Supervision** (Gates, Runs, Organization); a generic read-only viewer over any workspace object (versions with diff, raw, discuss). The five backends are **mocked in the browser**, one port each: workspace manager, conversation manager, agent runtime (SAF harness lifecycle replayed with scripted agents, no model called), PIS IAM (Keycloak), model gateway (Azure AI Foundry, fictitious price list).

## Run it

Requirements: Node 22.x, npm 10+.

```bash
npm ci
npm start            # http://127.0.0.1:4400
```

Walk the scenario: Workspace › Explorer (browse to the Feature, open it in the viewer, versions, raw) → Conversation › New → "Use the scenario" → Start → acknowledge the AI notice → Confirm and launch → the run reaches the ★ Architecture Gate: its conversation opens and the bell notifies you → Open the artifact → Decide → Supervision › Gates leads to the second gate → approve → Supervision › Runs (cost, time, statistics) → a run → a session → its log → Board → Supervision › Organization.

Hosting: the build works at a domain root or under a sub-path (`npx ng build --base-href /oap-web-frontend/`); `public/staticwebapp.config.json` configures Azure Static Web Apps; see `../def/deployment.md`.

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

Requires PyYAML. Output: `src/assets/saf-package/*.json` (agents, workflows, model profiles, item types, **workspace structure map**, roles; see `NOTICE.md` there) and `public/saf-package/organization-sources.json` (the organization files verbatim, fetched at startup and seeded under `organization/` in the mocked workspace git).

## Layout

```
src/app/core/domain            entities, lifecycles, notifications (no Angular)
src/app/core/ports             one port file per backend (workspace-manager, conversation-manager, agent-runtime, iam, model-gateway)
src/app/core/saf               harness contract mirrors, model-resolution rule, frontmatter and YAML readers
src/app/core/application       use cases, addressee rule, board derivation, workspace tree from the structure map, data tree,
                               organization view (folder, categories, history, gap), analysis (euros, durations, subjects)
src/app/infrastructure         mock-world.ts (composition root) + one folder per mocked backend
src/app/state                  signal store (SaiStore)
src/app/features               workspace (explorer like GitHub, board), conversation (layout, list, chat, new), supervision (gates, runs, run, organization)
src/app/shared                 viewer (versions with diff, raw, discuss), gate flow (four steps), diff view, file icons, data tree, Markdown view, badges
src/sai-tokens.css             design tokens (OIP names, indigo primary, ★ gate and AI accents)
src/assets/saf-package         fixtures generated from the SAF repositories
src/fonts                      self-hosted fonts (bundled by the builder, so any base href works)
public/saf-package             organization sources (fetched, not bundled)
tools/                         fixture generator, smoke test (`--base`, `--dist` for sub-path hosting checks)
```

## What is real and what is mocked

| Real | Mocked |
| --- | --- |
| Domain rules and lifecycles (oap#1), addressee rule, participant and tenant isolation, gate role checks, gate conversations and notifications | identities and tenants (fictitious, "acting as" switch) |
| Harness lifecycle order, log-entry contract, one validated write per commit, commit-gate rejection and retry, model resolution over the real catalog, budget stop, cancellation | step execution and artifact bodies (scripted texts) |
| SAF package content (agents, workflows, weights, statuses, model profiles, **workspace structure map**, roles) generated from the repositories | Copilot dispatcher, scopes, gates, launch inputs (declared by SAI pending saf#6 SF15) |
| Views rebuilt from workspace state and history; cost, duration, human wait and subject analysis derived from runs and usage records | persistence (in memory, lost on reload); model deployments and **prices** (fictitious EU data-zone names, euro bands by SAF cost rank) |
| The organization files of the SAFe package (176, verbatim) under `organization/` of the workspace git | the organization-change and organization-upgrade workflows (not in the package yet: SAF SF11, SF13) |

`public/runtime-config.js` carries `backends: 'mock' | 'live'` and one URL per backend for the day the adapters exist.
