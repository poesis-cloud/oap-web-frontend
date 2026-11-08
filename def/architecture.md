# SAI Web Frontend — architecture (revised 2026-11-08 evening)

Design-time material for the SAI web application. Normative sources, in order: affordance [poesis#40](https://github.com/poesis-cloud/poesis/issues/40) (rules R2–R18, constraints C1–C6), capability [oap#1](https://github.com/poesis-cloud/oap/issues/1) (features F1–F18, lifecycles), the feature issues of the three product repositories, [saf#6](https://github.com/poesis-cloud/saf/issues/6) "SAF for SAI", the SAF harness specification (`saf-agentic-harness/def/core/spec.md`). This document derives from them and never overrides them.

## 1. What SAI is, in one paragraph

SAI is a collaborative workspace of humans and agents working in framed, auditable workflows to deliver quality artifacts (R15). It is not an AI assistant and has no free chat: every exchange leads to a workflow launch confirmed by a human, to a consultation of an agent within its scope, or to an out-of-scope answer. Every workflow is a SAF organization executed by the SAF harness (R3). The frontend merges the roles of team messaging (Conversations), work tracking and documentation (Workspace) and supervision (Supervisor) in one minimalist web UI with **three surfaces** (Clément, 2026-11-08). It is developed against **five mocked backends**, one port each (ADR-007): workspace manager, conversation manager, agent runtime, PIS IAM (Keycloak), model gateway (Azure AI Foundry).

## 2. Boundaries of responsibility

| Concern | Owner | Port in the frontend | Mock |
| --- | --- | --- | --- |
| Views, collaboration UX, explorer and viewers, board, conversations and threads, supervisor | **oap-web-frontend** (this repo) | — | — |
| Hosted SAF workspaces (git; HEAD = state), SAI workspace records | **oap-workspace-manager** (F14, F17) | `WorkspaceReadPort`, `WorkspaceRepository` | `InMemoryWorkspace` |
| Conversations, threads, messages, launch proposals, notifications | **oap-conversation-manager** (F1, F17, S22) | `ConversationRepository`, `NotificationStore` | `InMemoryConversations`, `InMemoryNotifications` |
| Runs through the SAF harness, organization catalogue, conversational agents outside runs | **oap-agent-runtime** (F4, F7) | `RuntimePort`, `AgentResponderPort`, `OrganizationCatalog` | `MockAgentRuntime`, `ScriptedAgents`, `StaticCatalog` |
| Tenants (PIS Organizations), members, permissions, organization-declared roles | **PIS IAM on Keycloak** ([poesis#43](https://github.com/poesis-cloud/poesis/issues/43)) | `IdentityPort` | `MockKeycloak` |
| Model deployments, usage attribution | **Azure AI Foundry** behind the Poesis Models Gateway ([poesis#42](https://github.com/poesis-cloud/poesis/issues/42)) | `ModelGatewayPort` | `MockFoundry` |
| Workflows, roles, skills, instructions, orchestration, validation, model resolution, authorization, journals, artifact contracts, **workspace structure map** | **SAF** (harness, organization, workspace) | mirrored in `core/saf`, read as the organization package | fixtures generated from the SAF repositories |
| OIP embedding | **oip-web-frontend#9** (F11) | — | tokens aligned (ADR-006) |

### Source of truth

| Data | System of record | Read by the frontend |
| --- | --- | --- |
| Artifacts, organization of the workspace, run journals, run state and cost, gates, work items | hosted SAF workspace (git; one validated write = one commit) | `WorkspaceReadPort` (F14-R10) |
| Workspace structure (where each artifact kind lives) | the organization package (`conf/workspace.conf.yaml`) | `OrganizationPackage.workspaceStructure` → explorer tree |
| Workspaces, conversations, validation conversations, notifications | conversation manager / workspace manager stores (F17) | repository ports |
| Users, Organizations, memberships, permissions, roles | PIS IAM (OIDC claims) | `IdentityPort` → `Tenant`/`Member` |
| Model deployments allowed per tenant, usage records | model gateway | `ModelGatewayPort` |

## 3. Layers

```
features/        Presentation: Angular standalone components (workspace, conversations, supervisor + run detail)
shared/          Artifact viewer, data tree (JSON/YAML), Markdown view, gate card, badges
state/           Signal store: re-reads application views after each command, drives the mock scheduler, streams answers, toasts
core/
  application/   Use cases (SaiApplication), addressee rule, board derivation, workspace tree from the structure map, data tree
  domain/        Entities, value objects, lifecycles (workspace, conversation, thread, proposal, run, gate, notification)
  ports/         One file per backend: workspace-manager, conversation-manager, agent-runtime, iam, model-gateway
  saf/           Mirrors of the harness contracts, model-resolution rule, frontmatter reader, YAML subset reader
infrastructure/
  mock-world.ts  Composition root of the mocks
  <backend>/     One folder per mocked backend (ADR-007)
```

`core/` imports nothing from Angular. The presentation layer never implements a rule; it calls the application and renders. UI kit: PrimeNG + Tailwind on the OIP token names (ADR-006).

## 4. Flows

1. **Intent → launch proposal.** A human posts in a conversation. The addressee rule (F17-R4) routes to Copilot, to a mentioned agent or to the orchestrator of a `/workflow`. The responder answers within scope or returns a launch proposal (at most one pending per thread, F17-R2).
2. **Confirmation → run.** A human participant confirms. The runtime launches a run of the workflow on the organization at the current workspace commit (F4-R11). The conversation shows the run link.
3. **Run.** The runtime advances step by step on the harness lifecycle; each delivered artifact is one validated commit attributed to the step session (F14-R2); journal entries follow the harness log-entry contract; usage records are attributed per step (F3).
4. **★ Gate → validation conversation.** After the last step, the organization's gate opens; the run waits (F4-R3). SAI opens a *validation conversation* about the artifact, invites the holders of the gate role and the requester with the agents of the run, and notifies them (S22). Holders decide there, in Supervisor, on the board card or in the run detail. Rejection with a comment reroutes to rework; approval commits the acceptance (ADR accepted, Feature leaves `arch-pending`); a reservation records a pain point (F1-R11). The decision closes the validation conversation.
5. **History.** Board, artifact versions, run detail, journal and usage are all read from the workspace state and history; nothing is a UI-side database (F14-R4).

## 5. Non-goals of this build

Native apps (removed in the 2026-11-06 revision), organization learning runs (F16), MCP tools (F12), workspace connectors (F15), the organization builder (F6), tenant administration screens (F9), real sign-in through PIS, real model calls.
