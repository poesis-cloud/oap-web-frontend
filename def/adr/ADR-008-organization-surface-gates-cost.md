---
id: OAP-FE-ADR-008
title: Organization as a fourth surface, gates decided only in their conversation, cost and time on every run
status: proposed
product: oap-web-frontend
decision_scope: navigation and read model of the frontend mock
deciders:
  - Clément Cazaud (maintainer)
created: 2026-11-08
decided: null
supersedes: null
---

# OAP-FE-ADR-008 — Organization surface, gates as conversations, cost and time

## Context
Clément's directions relayed on 2026-11-08 (evening): add a menu item **Organization** ("everything in the SAF organization", knowing it lives in the workspace git and evolves through SAF organization workflows, some still to be created); target first the **Specialized configuration** serving the SAFe Agentic Organization; call the application **Organization Agentic Platform**; show on runs the **AI cost and the time they took**; give the Supervisor a **real end-to-end analysis** of subjects spanning several workflows and runs; **decisions must be gates, and gates are conversations**; and clarify what "Customer Platform" is (a workspace).

## Decision
1. **Four surfaces.** Workspace, Organization, Conversations, Supervisor. The Organization tab of Workspace moves to its own surface (`/organization`, redirect kept).
2. **The organization folder is seeded with the real SAF files.** `tools/import-saf-package.py` exports the organization repository's `agents/`, `workflows/`, `conf/`, `artifacts/`, `skills/`, `instructions/` verbatim (176 files, Apache-2.0) to `public/saf-package/organization-sources.json`; the app fetches it before bootstrap (`provideAppInitializer`) and the mocked workspace commits it under `organization/` as the tagged nominal import. The Workspace explorer leaves that folder out; the Organization surface browses it with the same viewers (Markdown, YAML, JSON), lists agents, workflows (with the SAF organization workflows still to be created: SF10–SF13) and the history with the gap to nominal. Its actions open conversations (F16-R11); the scripted dispatcher answers that the governed workflow does not exist in the package yet.
3. **Gates are decided only inside their conversation.** The gate card has a `mode`: `decide` in the gate conversation, `link` everywhere else (Supervisor, board, run detail, launching conversation). Supervisor lists all gates as conversations.
4. **Cost and time.** The model gateway port exposes `priceOf(model)` (euros per million tokens; the mock derives fictitious bands from the SAF cost rank). The analysis module (`core/application/analysis.ts`) computes per run the cost, the duration, the time waiting for humans at gates and agents at work, and groups runs by subject (the work item whose folder holds the run's artifacts). Supervisor gets KPIs, a Runs table and an Analysis tab; the run detail shows cost and duration per step.
5. **Naming.** UI, titles, favicon and documents say **Organization Agentic Platform (OAP)**; the sidebar states the instance configuration ("Specialized configuration · SAFe Agentic Organization"). Component selectors keep the `sai-` prefix (internal). SAI stays the name of the capability in the issues.

## Consequences
- The initial bundle stays under budget (organization sources are a fetched asset, ~170 kB compressed).
- Tests: analysis and organization-view specs; the smoke walk decides the second gate from its conversation and walks the Organization and Analysis views.
- Open for the backends: the run's subject should be a run input or a harness fact rather than a derivation from artifact folders; the price list comes from the Poesis Models Gateway (PIS F10).
