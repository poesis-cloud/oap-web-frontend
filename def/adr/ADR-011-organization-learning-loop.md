---
id: OAP-FE-ADR-011
title: The organization learning loop in the frontend mock (F16 slice); decisions as the human's message; every section reachable on small screens
status: proposed
product: oap-web-frontend
decision_scope: pain points, retrospectives, organization change and rollback in the mock; the dialogue of a ★ gate decision; phone and tablet navigation
deciders:
  - Clément Cazaud (maintainer)
created: 2026-11-09
decided: null
supersedes: null
---

# OAP-FE-ADR-011 — Organization learning loop, decisions as messages, small-screen navigation

## Context
Clément's feedback #3 (2026-11-09): "many dialogues make no sense, sometimes the roles are even inverted"; and the plan he approved: before the site, one OAP iteration centred on F16 (a pain point traced from the commit-gate rejections of the seeded scenario, a retrospective in conversation with one thread per pain point, an `organization-change` run up to its gate with a readable diff and a scorecard, a rollback), then full threads, then Agentic Organizations and workspace creation. Later the same evening, on a phone: "only three screens; neither the crumbs nor the menu navigate".

The SAF package (`saf-agentic-organization`, refreshed 2026-11-09: 25 workflows, `portfolio/` as the declared root of every path) now ships `improvement-backlog` (one pain point per run, by the Release Train Engineer) and the `pain-point` artifact, but no `organization-change` workflow, no scorecard and no ★ Organization gate (SAF SF10–SF13 are open).

## Decision
1. **Pain points come from the harness's own evidence.** Workspace › Improvement lists the commit-gate reverts observed in the runs of the workspace; "Record pain point" launches the SAF `improvement-backlog` workflow (human-confirmed, orchestrated by the RTE, one `pain-point` artifact under `portfolio/art/<art>/improvement-backlog/…` with `sourceRun`, `sourceStep`, `sourceSession`, `targetArtifact`). Capture is idempotent per run and step. The seeded scenario records one pain point from yesterday's run ("ADR status missing before the commit gate").
2. **A retrospective is a conversation.** "Start retrospective" opens a conversation where the RTE posts one message per open pain point and opens a child thread on each; humans and agents discuss there and a human **returns a conclusion** to the parent thread (`returnChildThread`: a thread returns only with a written conclusion, never while a proposal or run of the thread is active, and nested threads are returned or cancelled first). Threads are the F1-R12/R13 mechanics; the retrospective is their first real use.
3. **`organization-change` is a frontend contract candidate** (declared in `core/domain/improvement.ts`, labelled "frontend simulation" in the UI, never presented as a SAF workflow): draft (System Architect, the owner of the instruction file), challenge (Quality Engineer), scorecard baseline (RTE), then the **★ Organization Gate** held by `central-supervisor`. The proposal needs a pain point as evidence; the run's artifact is the exact before/after of **one** instruction file (`program-architectural-runway-extension-author-adr.instructions.md`); approval applies those bytes only if the live file still matches the reviewed baseline (a stale diff is refused atomically); the pain point moves to `triaged` with `resolution: workflow-improvement`. Runs already started keep the organization snapshot of their launch.
4. **The scorecard claims nothing unmeasured.** Baseline = the completed runs of the target workflow before the change; observation = the completed runs started under the applied bytes; measures: AI cost per accepted artifact (all attempts included), first-pass acceptance, gate returns, recurrence of the rejected write. Below three observation runs the UI says so. Costs and times stay simulated (R13: never on the site).
5. **A rollback is the same workflow with a revert** of the last applied change: its own run, its own gate, exact restoration of the previous bytes, the pain point back to `open`.
6. **A decision at a ★ gate is the human's own message**, kind `decision`, in their words ("Rejected: Partners need mTLS, not only bearer tokens." / "Approved."), rendered with the gate's label; the orchestrator then answers what it does with it (rework routed to the author with the comment, acceptance, or the reservation recorded as a pain point). No system line speaks in the decider's name any more. The seeded scenario adds the human question that motivates the rejection (Alex asks the security expert about token replay before rejecting).
7. **Agents answer in context.** Session conversations answer about their own step and artifact; the orchestrator answers during a gate about that gate; specialists answer within scope and never invent an estimate or a decision; the scripted ADR describes the Feature it serves (subscriptions, partner sandbox or invoicing export), chosen from the intent or the subject; "OAP", never "SAI", in what agents say.
8. **Agentic Organizations** (`/organizations`): the packages the instance offers, with their counts, and "Create a workspace" (name validated, unique per tenant, provisioned by the workspace manager mock with its nominal import, empty backlog, isolated from the other workspaces).
9. **Every section is reachable on every width.** On a phone the bottom bar's groups open a **sections sheet** (Explorer, Board, Improvement / Gates, Runs, Organization); the crumbs open the same sheet; an account button in the title bar opens the user menu (act as, pause runs, **workspace switch**); the explorer's tree and a run's sessions are sheets over the content. On a tablet the rail's group icons open the sheet beside the rail. One breakpoint (899 px) governs the stacked panes and their back buttons.

## Consequences
- 64 → 75 unit tests (`improvement.spec.ts`: capture, retrospective threads, atomic apply, rollback, snapshot pinning, stale approval, rejection sessions, workspace creation); the smoke walk gains the Improvement, organization change, rollback, Agentic Organizations and small-screen navigation steps.
- To be settled with SAF (drafts in `POESIS-SAI/issues-drafts/`): SF10 capture from harness signals (orchestrator-launched, not human-confirmed), SF11 `organization-change` steps and the holder role of the ★ Organization gate, SF12 scorecard measures, SF15 the `decision` message in the interaction contract.
- The mock supports one traced improvement (the ADR preflight); another pain point needs another change proposal. Package upgrades (SF13) and contributions to Poesis stay unavailable and are labelled so.
