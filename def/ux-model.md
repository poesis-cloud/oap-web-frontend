# OAP Web Frontend — UX model (CAP-A13 draft, revised 2026-11-09)

Views, navigation and user journeys of the web frontend, separate from the domain model (oap#1 "Expected deliverables"). Revised on Clément's UX feedback of 2026-11-08/09 (ADR-009): a **modern desktop-like application**, airy and consistent, not a site of pages. Product name in the UI: **Organization Agentic Platform (OAP)**, Poesis logo; the build stands for the **Specialized configuration serving the SAFe Agentic Organization**. Screenshots in `../../evidence/smoke/`.

## Principles

1. **An application frame, not pages.** Side menu with collapsible groups, a thin title bar (location, notifications, theme), and panes that fill the height with their own scrolling. No page headers, no explanatory text above the content.
2. **Content first, controls grouped.** Any workspace object opens in the same read-only **viewer**: title on top, one tool group (versions with diff, raw source, discuss), close. Metadata lives behind those buttons, not around the content.
3. **A workspace is one hosted SAF git repository**: its organization and its artifacts; the explorer browses both.
4. **A decision is a gate, and a gate lives in the conversation that launched the run.** The gate is the orchestrator's last message, awaiting a decision to close the workflow; its journey is visible as four steps (gate raised, review the artifact, decide, finalized); the decision controls exist only there. **One session = one conversation**: the orchestrator's session is the launching conversation, each worker session of a step has its own conversation where the agent exposes its work (ADR-010).
5. **Cost and time are first-class**: runs, sessions and subjects show tokens, euros, duration and the time spent waiting for humans.
6. **Live where it matters.** Active runs animate (spinner, shimmering progress, current step); everything else is still.
7. **The Poesis look** (poesis.cloud "Deep Field"): dark-first, deep-space surfaces, hairline borders, teal accent, indigo for AI, gold for gates, system fonts, 16 px cards; a lifted light theme; reduced motion respected; sentence case; no arrows on buttons; one quiet icon set (ADR-010).

## Frame and responsive behaviour

| Width | Menu | Panes |
| --- | --- | --- |
| ≥ 1024 px | full menu (logo, workspace switcher, groups with sub-items, user menu) | list pane 300 px (340 px for conversations) + content pane |
| 768–1023 px | icon rail with tooltips; a group icon opens the **sections sheet** beside the rail | list + content (stacked below 900 px) |
| < 768 px | hidden; bottom bar Workspace / Organizations / Conversation / Supervision: a group opens the **sections sheet** from the bottom, a single surface navigates; an account button in the title bar opens the user menu | one pane at a time: the explorer's tree and a run's sessions open as a sheet over the content from a button in the bar, a chosen item closes it; conversations show the list then the thread with a back button; the viewer overlay takes the whole pane |

Menu: **Workspace** (Explorer, Board, Improvement) · **Agentic Organizations** · **Conversation** · **Supervision** (Gates, Runs, Organization). The active group is open; others fold. Badges: gates waiting for the user, a pulsing dot while runs are active. User menu: workspace switch, act as (demonstration), pause or resume the simulated runs, run the demo scenario. Title bar: `workspace / section / sub-section`; the section and the sub-section are buttons that open the sections sheet of the group (Clément, 2026-11-09: on a phone every section must stay reachable, from the crumbs and the menu alike); a `demo` chip, theme, bell with unread count.

## Surfaces

### Workspace › Explorer
Left: the file tree laid on the organization's structure map (filterable, quiet file glyphs with a format tag, expected slots greyed). Centre: the **current directory like GitHub** (breadcrumbs in the bar; folders first with their description and file count; files with their kind, last change and time; `..` row). A folder changes the directory (`?dir=`); a file opens the **viewer over the listing**, which dims (`?file=`); Escape or the close button returns to the listing. The `organization/` folder is browsed here.

### Viewer (shared)
Title (frontmatter title or file name), path, status chip; tool group: **Versions** (side list of versions with author, commit, time; the selected version shows its **diff** against the previous one, the first version in full), **Raw** (`< >`, the source), **Discuss** (opens a conversation about the object); close. Markdown rendered (HTML comments dropped), YAML and JSON as collapsible trees, anything else as text. Used by the explorer, the board, the gates, the runs, the organization and the chat.

### Workspace › Board
Item types as a segmented control, columns by the declared statuses, quiet cards (id, title, ★ structurant, runs, gate waiting); a card opens the viewer.

### Workspace › Improvement (F16 slice, ADR-011)
Four stages (observe, discuss, change, measure). Pain points as cards (id, status, symptom, evidence in the viewer, source run, rejected session) with "Propose an improvement"; the observed friction (commit-gate reverts of the runs) with "Record pain point" (launches `improvement-backlog`); the retrospectives (one thread per pain point); the organization changes with their run, their gate conversation and the **change review** (readable diff of the instruction file, scorecard baseline / observation, links to the measured runs) and "Propose a rollback".

### Agentic Organizations
The packages the instance offers (name, version, intended use, agents, workflows, item types), "Create a workspace" (dialog: name), the tenant's workspaces (open or current).

### Conversation
List pane: title, search, **New** (+), filter All / Mine / Agent sessions, rows with the human's initials or the agent's square avatar for sessions, a gold pulse when a gate waits for the user, title, last message, time. Thread pane (chat): bar with back (phone), ★ for gates, title (double-click to rename), participants as stacked avatars, invite, details, archive; messages as bubbles with avatar, name, AI tag, time (mine tinted, agents outlined), provenance folded, side threads in place, launch proposal and run cards inline; composer with `@agent` and `/workflow` chips and a send button. A run launched here that waits at its ★ gate pins the **gate flow** at the top (and the change review for an organization change); the decision is then the human's own **decision message** (gate label, their words) answered by the orchestrator; a worker session conversation shows its step, run and status in the bar; step notices link the sessions; a child thread returns to its parent only with a written conclusion. Details panel (toggle): workspace, subject, participants, runs. New conversation: title, intent, chips, "Use the scenario", Start.

### Gate flow (shared)
Four steps: **Gate raised → Review the artifact → Decide → Finalized**. In the conversation that launched the run: "Open the artifact" (viewer over the thread) then the decision (approve, approve with reservation, reject with a comment); after the decision: who, when, comment, what happens next, links to the artifact, the run and the conversation. Elsewhere: the state and the way to the conversation ("Decide in the gate conversation" for holders, "Open the gate conversation" otherwise).

### Supervision › Gates
Bar: status (All / Pending / Decided) and my role (Any / I decide / I requested / I take part). Gates waiting for the user as flows first; then the table (gate, artifact → viewer, run, status, my role, decided by, when, Decide / Open → conversation).

### Supervision › Runs
Bar: Runs / Statistics; status (All / Active / At a gate / Done / Failed) and my role; pause or resume. KPI strip (active runs, sessions with agents and humans involved, tokens, AI cost, time at work and waiting). Rows: live status glyph, workflow and instance, subject, current step, progress (shimmering while active), cost, duration, tokens, gates ★, status → run. Statistics: one card per subject end to end (timeline work / gate wait, by workflow, by agent, by model), then by workflow for all subjects (cost per accepted artifact).

### Supervision › Run
Left: Overview, the orchestrator session, one worker session per step (status glyph, actor, model, cost). Centre: for a session, agent, model, tokens and cost, time; the step's status, artifact (viewer), commit, harness verdicts; **Session log** (harness journal entries); **Join the conversation** for the orchestrator, **Open the session conversation** for a worker. Overview: KPIs, gates as flows, failure, launch facts. Cancel while active.

### Supervision › Organization
Proposals (change, upgrade, rollback, to Poesis: each opens a conversation); indicators of what the organization declares as clickable tiles (explorer folders, viewer for configuration files, board, runs); gates and holders; agents (click → agent file in the viewer); where it lives (folder, nominal import, gap, harness); the SAF workflows to create; history (click → first changed file).

## Journeys (smoke walk `app/tools/smoke.mjs`)

| Journey | Steps | Evidence |
| --- | --- | --- |
| Explore and read | Explorer root → art/platform/program-backlog/… → Feature in the viewer → versions → raw → organization/conf/workspace.conf.yaml as a tree | F5-AC6, F5-AC9, F16-AC1 |
| Launch from an intent | Conversation › New → scenario → Start → AI notice → proposal → Confirm and launch | F1-AC3, S7-AC1, F17-AC2 |
| Gate journey | the orchestrator ends the workflow with the gate in the launching conversation (bell) → Open the artifact (viewer) → Decide → Reject with a comment → rework; Supervision › Gates → the waiting gate → review → Approve | S7-AC2, S7-AC3, F4-AC3, S22 |
| Follow runs | Runs list with cost and time → Statistics → run → worker session → session log → the session's conversation | F18-AC2, F1-AC4, R14 |
| Board and Organization | Board → card in the viewer; Organization → agent file in the viewer | F5-AC1, S61 |
| Consult, out of scope, small screens | consultation threads, no free chat; tablet and phone captures | F1-AC9, F1-AC7 |
| Phone and tablet navigation | bottom bar → sections sheet → Runs; crumbs → sheet → Organization; Improvement without overflow; a run's sessions sheet; account menu; explorer tree sheet; tablet rail → sheet → Gates | Clément 2026-11-09 |
| Improvement | pain point evidence → retrospective thread → returned conclusion | F16, F1-R12 |
| Organization change and rollback | proposal → run → ★ Organization Gate with diff and scorecard → approve → one file changed; rollback run → approve → identical to the package | F16-R11, SF11, SF12 |
| Agentic Organizations | create an isolated workspace, come back to the original | F17, F18-R5 |

## Open UX points
- Worker session conversations are scripted in the mock (opening, reverts, delivery, scoped answers); the real runtime will feed them from the harness session logs and model exchanges.
- Subject of a run derived from its artifacts; a run input naming it would be more robust.
- Price list fictitious until the Poesis Models Gateway publishes its list.
- Mermaid in Markdown not rendered yet (safe renderer needed); wording of the AI notice to validate.
