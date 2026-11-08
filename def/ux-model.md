# SAI Web Frontend — UX model (CAP-A13 draft, revised 2026-11-08 evening)

Views, navigation and user journeys of the web frontend, separate from the domain model (oap#1 "Expected deliverables"). Revised on Clément's direction: **simple and clean, three main entries**, the workspace structured by the SAF organization's workspace map with read-only previews, conversations about the artifacts, gates that invite reviewers into validation conversations, and a Supervisor. Wireframes are the running application; screenshots in `../../evidence/smoke/`.

## Principles

1. **One menu, three surfaces**: Workspace, Conversations, Supervisor. Runs live under Supervisor; the organization packages live under Workspace › Organization. Administration appears only for administrators (later).
2. **The workspace is the organization's map.** The explorer follows `conf/workspace.conf.yaml` of the loaded organization: folders and artifacts where the map puts them, required slots still empty shown in italics. No business concept is hard-coded (R18).
3. **Preview, never edit.** Every artifact opens read-only in its native format with source and history; writing happens only through runs (R15, F5-R7, F5-R9).
4. **Conversations are about artifacts.** A conversation may carry a `subject` (the artifact it is about); "Discuss" in the viewer opens one. Agents are participants labelled AI with provenance (R6).
5. **A gate is a conversation.** When a run reaches a ★ gate, SAI opens a *validation conversation*, invites the holders of the gate role and the requester, pins the gate card, and notifies them (bell, Supervisor activity). The decision closes the conversation and resumes or ends the run.
6. **Folded internals.** Progress, gates and results first; steps, agents, models and journals are one click away for everyone (F1-R7, F5-R5).
7. **Same look as OIP.** PrimeNG + Tailwind on shared token names; light and dark; reduced motion respected.

## Layout

| Breakpoint | Navigation | Work area |
| --- | --- | --- |
| ≥ 768 px | dark sidebar: brand, workspace switcher, three entries (Supervisor badge = gates + failed runs), mock note with "Pause runs", acting-as switch (IAM mock) | header: workspace / section, theme, notifications bell with unread count, avatar |
| < 768 px | bottom tab bar with the three entries | header only; conversation context panel hidden below 1280 px |

## Surfaces

### Workspace
- **Explorer** (default): left, the tree from the structure map (filterable; folders gold, Markdown blue, YAML/JSON violet, expected slots italic and unselectable; artifact kind as a small chip); right, the **artifact viewer**: path, title, kind, status, format, version count; tabs *Rendered* (Markdown with frontmatter table; YAML/JSON as collapsible trees with typed values; text otherwise), *Source*, *History* (version, commit, author, producing run and step); actions *Discuss* and links to the conversations about the artifact. Deep link `/workspace?path=…`.
- **Board**: item type chips (declared by the organization), columns = declared statuses, cards (id, title, ★ structurant, runs count, gate waiting), search; a card opens a right drawer (status, path, pending gate card, runs, artifacts of the folder).
- **Organization**: the workspace's organization (package, harness, license, counts, structure coverage, intended use, limitations), item types and statuses, agents, workflows (steps, capability weights, ★ gate, native JSON), packages offered by the instance (F18-R5).

### Conversations
- List with filters *All / Work / ★ Validation*, search, new conversation (title, intent, "Use the scenario"); each row shows kind, subject chip, status, participants and counts.
- Conversation: header (back, ★ for validations, title with rename on double-click, status, subject link, archive/restore), participants with invite selects (agents of the organization, colleagues of the tenant); for a validation, the **gate card pinned** at the top; main thread with child threads in place; messages: text (streamed, Stop), launch proposal card (Confirm / Change / Cancel), run card (progress, folded internals), gate card or notice, system notices (including the link to the validation conversation a gate opened); composer with chips; AI notice dialog at first use (F1-R2). In a validation conversation humans discuss without triggering agents; `@agent` still asks an agent of the run.
- Context panel (≥ 1280 px): workspace, organization, subject or structurant Feature, runs of the conversation.

### Supervisor (home)
- **Waiting for your decision**: the gates the user may decide, as gate cards with the link to their validation conversation.
- **Runs**: active runs with progress and token count; past runs with status, cost and failure reason; detail at `/supervisor/runs/:id` (KPIs: steps, tokens in/out, cost per accepted artifact, budget; gates; failure or partial artifacts; steps with actor, model profile, verdicts and session folded; journal folded; usage records folded; cancel while active).
- **Activity**: the notifications feed (gate invitations, decisions, run results, budget alerts, invitations), click to open the target, mark all read.
- **Budget and models**: tenant tokens vs limit with alert ratio, EU-only flag, model deployments allowed for the tenant (data zone, region).
- **Recent decisions**.

## Journeys (acceptance references, smoke walk `app/tools/smoke.mjs`)

| Journey | Steps | Evidence |
| --- | --- | --- |
| J4 Explore and preview | Workspace › Explorer → Feature (Markdown) → product manifest (YAML tree) | F5-AC6, F5-AC9 |
| J1 Launch from an intent | Conversations → new → intent → Copilot hands off → RTE proposes → Confirm | F1-AC3, S7-AC1, F17-AC2 |
| J3 Gate → validation conversation → decision | run reaches ★ → notification → validation conversation → Reject with comment (closes it) → rework → Supervisor → Approve | S7-AC2, S7-AC3, F4-AC3, S22 |
| J2 Follow the run | Supervisor → run detail; unfold verdicts and journal | F18-AC2, F1-AC4 |
| J4 Read the result | Board (Feature ready) → ADR rendered with history | F5-AC1, F5-AC6 |
| J5 Consult specialists | "consult both …" → two child threads → resume | F1-AC9 |
| J6 Out of scope | small talk → closest workflows, no answer | F1-AC7 |

## Open UX points
- Validation conversation: one per gate (implemented) or a child thread of the launching conversation.
- Expected slots in the explorer: always shown (implemented) or behind a toggle.
- Mermaid diagrams in Markdown (F5-R9): not rendered yet (safe renderer needed).
- Wording of the AI notice, to validate with legal (S1 open point).
