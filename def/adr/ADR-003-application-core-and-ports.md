---
id: SAI-FE-ADR-003
title: Framework-agnostic application core with ports to the runtime and the workspace
status: proposed
product: oap-web-frontend
decision_scope: internal architecture of the frontend and its boundary with oap-web-backend and oap-agent-runtime
deciders:
  - Clément Cazaud (maintainer)
created: 2026-11-08
decided: null
---

# SAI-FE-ADR-003 — Application core and ports

## Context
The SAI backend and agent runtime do not exist yet; their responsibilities are specified in sai#1 (F17 store and APIs; F4 runtime; F14 hosted workspaces read through git). The frontend must be built now, remain honest about what is simulated, and swap the simulation for the real services without rewriting views.

## Decision scope
Where business rules live in the frontend, how the frontend talks to the backend and the runtime, and how the deterministic demo runtime is isolated.

## Decision
A framework-agnostic core (`core/domain`, `core/saf`, `core/application`) holds the entities, lifecycles and use cases of slice 1 and depends only on ports:

| Port | Production implementation (planned) | Slice 1 implementation |
| --- | --- | --- |
| `WorkspaceReadPort` | git read access to the hosted SAF workspace (F14-R10), through `oap-agent-runtime` read API | `InMemoryWorkspaceRepository` |
| `RuntimePort` | `oap-agent-runtime` HTTP API: launch, gate decisions, cancel, events (F4) | `DemoRuntime` replaying the harness lifecycle with scripted artifacts |
| `ConversationRepository`, `WorkspaceRepository`, `TenantRepository` | `oap-web-backend` APIs (F17, F9) and PIS claims | in-memory repositories seeded with fictitious data |
| `AgentResponderPort` | model calls through the configured model source (S15, F2) | `DemoResponder` with scripted answers |
| `UsageLedger` | `oap-web-backend` usage attribution (F3) | in-memory ledger |
| `OrganizationCatalog` | packages offered by the instance (F7, F18-R5) | fixtures generated from the real SAF package |

The Angular layer (`state/SaiStore`, `features/*`) never implements a rule: it calls the application service and re-reads views.

## Invariants the core enforces
- Only a human participant confirms a launch proposal (F17-R2); at most one proposal is pending per thread.
- Only a holder of the organization-declared role decides a gate (F4-R3); a rejection needs a comment.
- Humans never write to the workspace; only the runtime does (F17-R6); views read only.
- Workspaces and conversations are visible only to members of their tenant, and conversations only to their participants (F17-R7, F1-R4).
- Lifecycle transitions pass through one guard (`lifecycles.ts`).

## Consequences
- The demo runtime is a product risk if mistaken for the real one: every surface labels it ("Demo runtime", provenance `demo-scripted`), and the README states what is simulated.
- Replacing an adapter is a composition change in `infrastructure/`, not a change in `core/` or `features/`.
- The OpenAPI contract proposal for F17/F4 lives in `POESIS-SAI/docs/api-contract.openapi.yaml` until the backend repository owns it.

## Implementation hooks
`app/src/app/core/application/ports.ts`, `app/src/app/infrastructure/demo/*`, `app/src/app/state/sai-store.ts`.
