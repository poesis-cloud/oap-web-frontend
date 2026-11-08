---
id: SAI-FE-ADR-007
title: One mock per backend behind one port each — supersedes ADR-005
status: proposed
product: oap-web-frontend
decision_scope: how the frontend is developed while the backends' concepts are not settled
deciders:
  - Clément Cazaud (maintainer)
created: 2026-11-08
decided: null
supersedes: SAI-FE-ADR-005
---

# SAI-FE-ADR-007 — Mocked backends

## Context
Clément (2026-11-08): focus on the OAP frontend and **mock the backend**, which will be made of the workspace manager, the conversation manager, the agent runtime, PIS IAM (Keycloak) and Azure AI Foundry, because their concepts, domains and rules are not dry yet. ADR-005 had one "demo runtime" standing for everything.

## Decision
Split the infrastructure by backend, one folder per service, each implementing the port the application layer declares for it (`core/ports/<backend>.ts`):

| Backend | Port(s) | Mock |
| --- | --- | --- |
| workspace manager | `WorkspaceReadPort`, `WorkspaceRepository` | `InMemoryWorkspace` (git-like history, HEAD = state), seed |
| conversation manager | `ConversationRepository`, `NotificationStore` | `InMemoryConversations`, `InMemoryNotifications` |
| agent runtime | `RuntimePort`, `AgentResponderPort`, `OrganizationCatalog` | `MockAgentRuntime` (harness lifecycle replay), `ScriptedAgents`, `StaticCatalog` |
| PIS IAM (Keycloak) | `IdentityPort` | `MockKeycloak` (realm per tenant, members, roles; "acting as" switch) |
| model gateway (Azure AI Foundry) | `ModelGatewayPort` (deployments, usage ledger) | `MockFoundry` (EU data-zone deployments, token ledger) |

`infrastructure/mock-world.ts` is the composition root. `core/` imports nothing from `infrastructure/`. Replacing a mock by an HTTP or git adapter touches one folder and the composition root; `public/runtime-config.js` already carries a `backends: 'mock' | 'live'` switch and one URL per backend.

## Rules kept from ADR-005
No model is called; agents are scripted and labelled; the harness lifecycle, log-entry contract, one-validated-write-per-commit, commit-gate revert and retry, model resolution over the real catalog, budget stop and cancellation are replayed faithfully; every surface says "mock".

## Consequences
- The ports are the **contract proposal** for the five backends; they should be reviewed by their owners before implementation (see `issues-drafts/`).
- When a backend's concepts settle, its mock becomes the fixture of that backend's contract tests.

## Implementation hooks
`app/src/app/core/ports/`, `app/src/app/infrastructure/`, `app/src/app/core/config/runtime-config.ts`.
