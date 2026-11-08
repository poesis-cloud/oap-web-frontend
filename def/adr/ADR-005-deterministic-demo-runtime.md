---
id: SAI-FE-ADR-005
title: Deterministic demo runtime for the first vertical slice
status: superseded
superseded_by: SAI-FE-ADR-007
product: oap-web-frontend
decision_scope: how slice 1 demonstrates runs without a hosted harness or a model source
deciders:
  - Clément Cazaud (maintainer)
created: 2026-11-08
decided: null
---

# SAI-FE-ADR-005 — Deterministic demo runtime

## Context
The mission requires a first functional experience (workspace → conversation → launch → run → artifact → gate → history) that calls no paid model and never presents mocks as autonomous agents. The hosted SAI host adapter for the harness (saf#6 SF1) and the Poesis Models Gateway (poesis#42) are not available.

## Options
| Option | Assessment |
| --- | --- |
| A. Run the real Python harness from a Node bridge over a temporary git workspace, with scripted agents | Highest fidelity, but needs Python 3.10–3.12, a git working tree and a process boundary the browser cannot own; not deliverable inside a static web app |
| B. Deterministic in-browser runtime replaying the harness lifecycle with scripted artifacts and journal entries in the real contract shape | **Chosen**: reproducible, free, testable, honest when labelled |
| C. Call a free or local model | Non-deterministic, unverifiable acceptance evidence, and against the instruction not to call models |

## Decision
Implement `DemoRuntime` behind `RuntimePort`. For each step it journals the harness functions in their lifecycle order (start-session, resolve-step, resolve-step-model, step session start, preconditions, instructions, skills, authorization, commit gate, postconditions, end-session), commits one validated write per delivered artifact, shows the commit gate rejecting one invalid write and the retry, raises the organization's ★ gate, reroutes on rejection, and records cost per step. Agent texts and artifact bodies are scripted. Every surface says so.

## Consequences
- Evidence produced with this runtime is evidence of the SAI experience and of contract conformance, not of harness value (poesis#40 R13: no quantified claim).
- Option A remains the recommended next step to produce real harness verdicts as fixtures (`docs/09-roadmap.md`).

## Implementation hooks
`app/src/app/infrastructure/demo/demo-runtime.ts`, `scripts.ts`, `demo-responder.ts`, `seed.ts`.
