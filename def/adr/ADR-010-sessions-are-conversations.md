---
id: OAP-FE-ADR-010
title: One session = one conversation; a ★ gate is the orchestrator's message awaiting a decision; the Poesis design system in the application
status: proposed
product: oap-web-frontend
decision_scope: conversation model of runs and gates; visual identity of the application
deciders:
  - Clément Cazaud (maintainer)
created: 2026-11-09
decided: null
supersedes: null
---

# OAP-FE-ADR-010 — Sessions are conversations, gates are messages, Poesis identity

## Context
Clément's feedback #2 (2026-11-09): the style is still not the Poesis one; "in runs and conversations, for each step, we want to reach the worker session like the orchestrator session of the workflow: one session = one conversation, where the agent exposes its reasoning and its exchanges with the launcher or other actors; gates live in a conversation; do not distinguish work and gate conversations: a gate is an orchestrator's answer at the end of the workflow, awaiting a decision to close it". He pointed at poesis.cloud for the visual identity, and asked whether the mock has a scenario that creates run data.

## Decision
1. **Conversation model.** Two kinds only: `work` (humans and agents; the conversation that launches a run **is** the orchestrator's session) and `session` (one per worker session of a step, carrying `sessionRef { runId, sessionId, stepSlug, agent }`). The former "validation conversation" is removed: a raised ★ gate is a `gate` message by the orchestrator in the launching conversation; the holders of the role are joined there and notified; the decision is taken there and closes the workflow, not the conversation.
2. **Sessions as conversations.** On `step-started` the application opens the worker session conversation (agent, orchestrator and launcher as participants) with the agent's opening message; `commit-gate-reverted` and `step-delivered` append the agent's account; the launching conversation gets a one-line notice per step linking the session. A message without address in a session goes to its agent; during a gate, to the orchestrator (scripted answer about the gate).
3. **Navigation.** Run detail: "Join the conversation" for the orchestrator, "Open the session conversation" for each step. Conversation list filters: All, Mine, Agent sessions; a gold pulse marks a conversation where a gate waits for the user. Supervision › Gates leads to the launching conversation.
4. **Seeded scenario.** The mock world starts with history on a back-dated scripted clock: one run completed yesterday (gate rejected, rework, approved) and one run waiting at its gate for the current user; "Run the demo scenario" is reachable from the user menu and the empty states.
5. **Poesis design system in the app** (`sai-tokens.css`): dark-first "Deep Field" tokens of poesis.cloud (deep-space surfaces, hairline borders, teal→cyan accent, indigo for AI, gold for gates, system fonts, 16 px cards, 10 px controls), a lifted light theme; typography 14/1.5 body, 700/−0.02em headings; spacing on a 4 px grid; one 160 ms transition; the aura gradient on content panes.

## Consequences
- `Conversation.gateRef` and `refs.validationConversationId` are gone; `sessionRef` and `refs.sessionConversationId` replace them; `gateConversationFor` and `sessionConversation` are the reads.
- The scenario spec covers the gate in the launching conversation, the holders' invitation, the orchestrator's answer during a gate, and the worker session conversations (64 tests).
- Open: in the real runtime, worker session conversations come from the harness session logs and model exchanges (oap-agent-runtime, oap-conversation-manager contracts).
