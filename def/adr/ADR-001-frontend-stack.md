---
id: SAI-FE-ADR-001
title: Frontend stack of the SAI web application
status: proposed
product: oap-web-frontend
decision_scope: web application framework, language, build and test toolchain
deciders:
  - Clément Cazaud (maintainer)
consulted:
  - Nicolas (SAI developer)
created: 2026-11-08
decided: null
---

# SAI-FE-ADR-001 — Frontend stack of the SAI web application

## Context
SAI is web only, delivered as multi-tenant web instances and embedded in OIP (poesis#40 D1, C6). The frontend must be maintainable by the Poesis team, testable without a backend, and compatible with the OIP web frontend that will embed it (oip-web-frontend#9).

## Decision scope
The application framework, language level, build and unit-test toolchain of `oap-web-frontend`. UI kit and styling are a separate decision (ADR-002).

## Option evaluation criteria

| Criterion | Why it matters for this decision | Weight | How to read the score |
| --- | --- | --- | --- |
| Consistency with POESIS frontends | `oip-web-frontend` and Clément's Copilot instructions standardize Angular 21; one skill set for the team | H | higher is better |
| Embeddability in OIP | SAI is embedded as a widget in an Angular host | H | higher is better |
| Testability without backend | Slice 1 runs with a deterministic demo runtime | M | higher is better |
| Toolchain weight on the developer workstation | 8 GB RAM, little disk; CI minutes | M | higher is better |

## Options evaluation

| Option | Consistency | Embeddability | Testability | Toolchain weight | Summary assessment |
| --- | --- | --- | --- | --- | --- |
| A. Angular 21 (standalone components, signals, Vitest via `@angular/build`) | 5 | 5 (same framework as the host) | 5 | 3 | **Chosen** |
| B. React + Vite | 2 (no POESIS frontend uses it; the ITIP briefs that named React are obsolete) | 3 (web component or iframe bridge needed) | 5 | 4 | Rejected: breaks team consistency |
| C. Next.js | 1 | 2 (SSR runtime not wanted inside OIP) | 4 | 2 | Rejected |

1. **Option A** — matches the existing stack, the maintainer's instructions and the embedding host; signals give a small, zoneless runtime.
2. **Option B** — good tooling but a second frontend stack in a small team, and an extra bridge for embedding.
3. **Option C** — server rendering brings an operational surface SAI does not need.

## Decision
Use Angular 21 with standalone components and signals, TypeScript 5.9 in strict mode, the `@angular/build` application builder and Vitest for unit tests. Pin the versions already used by the Poesis workstation (`@angular/*` 21.2.x) so that `npm ci` reproduces the environment.

## Formal specification of the selected option
- `app/` holds the Angular project; `def/` holds design-time material, as the repository README states.
- Layers: `core/domain` (entities, lifecycles), `core/saf` (harness contract mirrors), `core/application` (use cases and ports), `infrastructure/*` (adapters), `features/*` (presentation), `state/` (signal store). `core/` imports nothing from Angular.
- Unit tests run with Vitest in a Node environment for the core and the demo runtime; template type-checking is strict (`strictTemplates`).
- No zone.js: change detection is signal-driven.

## Consequences
- ADR-002 chooses the UI kit and styling approach.
- The future `oap-agent-runtime` and `oap-web-backend` adapters replace the demo infrastructure behind the same ports (ADR-003).

## Implementation hooks
Repos and code areas impacted: `oap-web-frontend/app` (whole project). Compatible with `oip-web-frontend` (Angular 21) for the F11 widget.
