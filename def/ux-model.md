# OAP Web Frontend — UX model (CAP-A13 draft, revised 2026-11-08 night)

Views, navigation and user journeys of the web frontend, separate from the domain model (oap#1 "Expected deliverables"). Revised on Clément's directions of 2026-11-08: **simple and clean, four main entries** (Workspace, Organization, Conversations, Supervisor); the workspace structured by the SAF organization's workspace map with read-only previews; the organization of the workspace browsable as "everything in the SAF organization"; **decisions are gates and gates are conversations**; every run shows its **AI cost in euros and the time it took**; the Supervisor offers a **real end-to-end analysis** of a subject across workflows and runs. The product name in the UI is **Organization Agentic Platform (OAP)**; the build stands for the **Specialized configuration serving the SAFe Agentic Organization** (first target). Wireframes are the running application; screenshots in `../../evidence/smoke/`.

## Principles

1. **One menu, four surfaces**: Workspace, Organization, Conversations, Supervisor. Runs live under Supervisor. Administration appears only for administrators (later).
2. **A workspace is one hosted SAF git repository**: its organization and its artifacts (the header and the switcher say so; "Customer Platform" is the demonstration workspace of the fictitious tenant Acme IT).
3. **The workspace is the organization's map.** The explorer follows `conf/workspace.conf.yaml` of the loaded organization: folders and artifacts where the map puts them, required slots still empty shown in italics. No business concept is hard-coded (R18).
4. **The organization is part of the workspace.** It lives under `organization/` in the workspace git (agents, workflows, skills, instructions, artifact schemas and templates, configuration), imported from the SAF package as one tagged commit, browsed read-only, changed only through governed `organization-change` / `organization-upgrade` runs that SAF still has to create (F16, SF11, SF13). Every action of the surface opens a conversation with the orchestrator (F16-R11).
5. **Preview, never edit.** Every artifact opens read-only in its native format with source and history; writing happens only through runs (R15, F5-R7, F5-R9).
6. **Conversations are about artifacts.** A conversation may carry a `subject`; "Discuss" in the viewer opens one. Agents are participants labelled AI with provenance (R6).
7. **A decision is a gate, and a gate is a conversation.** When a run reaches a ★ gate, OAP opens the *gate conversation*, invites the holders of the gate role and the requester with the agents of the run, pins the gate card and notifies them. The decision is taken **only there**; Supervisor, board and run detail show the gate and lead to its conversation.
8. **Cost and time are first-class.** Each run shows its AI cost (euros rated by the model gateway), its duration, and the time spent waiting for humans at gates versus agents at work; the Supervisor follows a subject (Feature, Story, Epic) end to end across all its runs.
9. **Folded internals.** Progress, gates and results first; steps, agents, models and journals one click away for everyone (F1-R7, F5-R5).
10. **Same look as OIP.** PrimeNG + Tailwind on shared token names; light and dark; reduced motion respected. Links that are controls (navigation, rows, buttons) never underline.

## Layout

| Breakpoint | Navigation | Work area |
| --- | --- | --- |
| ≥ 768 px | dark sidebar: OAP mark and name with the instance configuration line ("Specialized configuration · SAFe Agentic Organization"), labelled workspace switcher, four entries (Supervisor badge = gates + failed runs, Conversations dot = runs in progress), mock note with "Pause runs", acting-as switch (IAM mock) | header: Workspace *name* / section, theme, notifications bell with unread count, initials |
| < 768 px | bottom tab bar with the four entries | header only; conversation context panel hidden below 1280 px |

## Surfaces

### Workspace
- **Explorer** (default): left, the tree from the structure map (filterable; mapped folders open, expected slots italic and unselectable; artifact kind as a small chip; the `organization/` folder is left out and linked to the Organization surface); right, the **artifact viewer**: path, title, kind, status, format, version count; tabs *Rendered* (Markdown with frontmatter table; YAML/JSON as collapsible trees), *Source*, *History* (version, commit, author, producing run and step); *Discuss* and links to the conversations about the artifact. Deep link `/workspace?path=…`.
- **Board**: item type chips (declared by the organization), columns = declared statuses, cards (id, title, ★ structurant, runs count, gate waiting), search; a card opens a right drawer (status, path, pending gate card leading to its conversation, runs, artifacts of the folder).

### Organization
- **Overview**: where it lives (folder, repository, nominal import tag and commit, HEAD, gap to nominal) and how it changes (governed workflows, with the four actions *Propose a change / an upgrade / a rollback / to Poesis*, each opening a conversation); the package (instance configuration, id, version, harness, license, intended use, limitations, packages offered by the instance); what the organization declares (counts of agents, workflows, skills, instructions, schemas, templates, configuration files, item types, model profiles, each a link).
- **Agents**: the Copilot dispatcher (declared by OAP pending SF15), orchestrators and specialists with scope, the artifact kinds each may write (access-control list) and a link to the agent file; the ★ gates with their holder roles and who holds them in the tenant.
- **Workflows**: by layer (portfolio, program, team), expandable (description, ★ gate, steps with actor, artifact, preconditions and capability weights), link to the workflow file; the block *Organization workflows · to be created in SAF* (organization-change SF11, organization-upgrade SF13, scorecard SF12, pain-point capture SF10).
- **Browse**: the `organization/` tree (agents, workflows, skills, instructions, artifacts, conf, manifest) with the same artifact viewer as the workspace (176 real SAF files in their native format). Deep link `/organization/browse?path=…`.
- **History**: the commits that touched the organization (nominal import tagged) and the gap to nominal.

### Conversations
- List with filters *All / Work / ★ Validation*, search, new conversation (title, intent, "Use the scenario"); each row shows kind, subject chip, status, participants and counts.
- Conversation: header (back, ★ for gates, title with rename on double-click, status, subject link, archive/restore), participants with invite selects; for a gate conversation, the **gate card pinned at the top with the decision controls** (only here); main thread with child threads in place; messages: text (streamed, Stop), launch proposal card (Confirm / Change / Cancel), run card (progress, folded internals), gate summary leading to the gate conversation, system notices; composer with chips; AI notice dialog at first use (F1-R2). An organization proposal is answered by the dispatcher: the governed workflow does not exist in the package yet, the proposal is handed to the orchestrator as a pain point.
- Context panel (≥ 1280 px): workspace, organization, subject or structurant Feature, runs of the conversation.

### Supervisor (home)
- KPI strip: gates waiting for the user (and pending in the workspace), runs (active, total, artifacts accepted), AI cost this session (euros), time (agents at work · waiting for humans).
- **Gates** (default): *Waiting for your decision* as gate cards leading to their conversation; *All gates* (pending first) with artifact, run, status, decider, when, and the button *Decide* / *Open* to the gate conversation; *Activity* (notifications); *Budget and models* (tokens vs limit, euros rated, deployments with their price per million tokens).
- **Runs**: table of every run with subject (work item), status, started, duration, waiting for humans, tokens, AI cost, gates as chips leading to their conversations; detail at `/supervisor/runs/:id` (KPIs: AI cost, duration, waiting for humans vs agents at work, steps delivered with accepted artifacts and gate rework, budget; gates; steps with cost and duration per step; verdicts, journal and usage folded; cancel while active).
- **Analysis**: one card per **subject** (the work item the runs worked on) across every workflow and run: totals (AI cost, end-to-end elapsed, agents at work, waiting for humans), a timeline with one bar per run split into work and gate-wait segments, breakdowns by workflow, by agent and by model (euros, calls, tokens), accepted artifacts and gate reworks; then the table *By workflow, all subjects* (runs, succeeded, average duration, AI cost, cost per accepted artifact in euros, R14). Measures are the workspace's own history, not a benchmark (F16-R8).

## Journeys (acceptance references, smoke walk `app/tools/smoke.mjs`)

| Journey | Steps | Evidence |
| --- | --- | --- |
| J4 Explore and preview | Workspace › Explorer → Feature (Markdown) → product manifest (YAML tree) | F5-AC6, F5-AC9 |
| J1 Launch from an intent | Conversations → new → intent → Copilot hands off → RTE proposes → Confirm | F1-AC3, S7-AC1, F17-AC2 |
| J3 Gate → gate conversation → decision | run reaches ★ → notification → gate conversation → Reject with comment (closes it) → rework → Supervisor shows the second gate as a conversation link → decide inside the conversation → Approve | S7-AC2, S7-AC3, F4-AC3, S22 |
| J2 Follow the run | Supervisor → run detail with AI cost, duration, waiting for humans; unfold verdicts and journal | F18-AC2, F1-AC4 |
| J4 Read the result | Board (Feature ready) → ADR rendered with history | F5-AC1, F5-AC6 |
| J7 Organization | Organization › Overview → Agents → Workflows → Browse (agent file, workspace map YAML) → History | F16-AC1, S61, S69 |
| J8 Analyse | Supervisor › Runs (cost, time) → Analysis (subject end to end) | F18-R4, R14 |
| J5 Consult specialists | "consult both …" → two child threads → resume | F1-AC9 |
| J6 Out of scope | small talk → closest workflows, no answer | F1-AC7 |

## Open UX points
- Gate conversation: one per gate (implemented) or a child thread of the launching conversation.
- Expected slots in the explorer: always shown (implemented) or behind a toggle.
- Mermaid diagrams in Markdown (F5-R9): not rendered yet (safe renderer needed).
- Wording of the AI notice, to validate with legal (S1 open point).
- Price list: fictitious bands by SAF cost rank until the Poesis Models Gateway publishes its list (PIS F10).
- Subject of a run: derived from the folder of its artifacts (works for SAFe items); a run input naming the subject would be more robust (open for the runtime contract).
