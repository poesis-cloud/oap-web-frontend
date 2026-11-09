# OAP Web Frontend — UX model (CAP-A13 draft, revised 2026-11-09)

Views, navigation and user journeys of the web frontend, separate from the domain model (oap#1 "Expected deliverables"). Revised on Clément's UX feedback of 2026-11-08/09 (ADR-009): a **modern desktop-like application**, airy and consistent, not a site of pages. Product name in the UI: **Organization Agentic Platform (OAP)**, Poesis logo; the build stands for the **Specialized configuration serving the SAFe Agentic Organization**. Screenshots in `../../evidence/smoke/`.

## Principles

1. **An application frame, not pages.** Side menu with collapsible groups, a thin title bar (location, notifications, theme), and panes that fill the height with their own scrolling. No page headers, no explanatory text above the content.
2. **Content first, controls grouped.** Any workspace object opens in the same read-only **viewer**: title on top, one tool group (versions with diff, raw source, discuss), close. Metadata lives behind those buttons, not around the content.
3. **A workspace is one hosted SAF git repository**: its organization and its artifacts; the explorer browses both.
4. **A decision is a gate, and a gate is a conversation.** The gate journey is visible as four steps (gate raised, review the artifact, decide, finalized); the decision controls exist only in the gate conversation.
5. **Cost and time are first-class**: runs, sessions and subjects show tokens, euros, duration and the time spent waiting for humans.
6. **Live where it matters.** Active runs animate (spinner, shimmering progress, current step); everything else is still.
7. **Same look as OIP**: PrimeNG + Tailwind on shared tokens; light and dark; reduced motion respected; sentence case; no arrows on buttons; one quiet icon set.

## Frame and responsive behaviour

| Width | Menu | Panes |
| --- | --- | --- |
| ≥ 1024 px | full menu (logo, workspace switcher, groups with sub-items, user menu) | list pane 300 px (340 px for conversations) + content pane |
| 768–1023 px | icon rail with tooltips | list + content |
| < 768 px | hidden; bottom bar Workspace / Conversation / Supervision | one pane at a time (list, then content with a back button); the viewer overlay takes the whole pane |

Menu: **Workspace** (Explorer, Board) · **Conversation** · **Supervision** (Gates, Runs, Organization). The active group is open; others fold. Badges: gates waiting for the user, a pulsing dot while runs are active. User menu: act as (demonstration), pause or resume the simulated runs. Title bar: `workspace / section / sub-section`, a `demo` chip, theme, bell with unread count.

## Surfaces

### Workspace › Explorer
Left: the file tree laid on the organization's structure map (filterable, quiet file glyphs with a format tag, expected slots greyed). Centre: the **current directory like GitHub** (breadcrumbs in the bar; folders first with their description and file count; files with their kind, last change and time; `..` row). A folder changes the directory (`?dir=`); a file opens the **viewer over the listing**, which dims (`?file=`); Escape or the close button returns to the listing. The `organization/` folder is browsed here.

### Viewer (shared)
Title (frontmatter title or file name), path, status chip; tool group: **Versions** (side list of versions with author, commit, time; the selected version shows its **diff** against the previous one, the first version in full), **Raw** (`< >`, the source), **Discuss** (opens a conversation about the object); close. Markdown rendered (HTML comments dropped), YAML and JSON as collapsible trees, anything else as text. Used by the explorer, the board, the gates, the runs, the organization and the chat.

### Workspace › Board
Item types as a segmented control, columns by the declared statuses, quiet cards (id, title, ★ structurant, runs, gate waiting); a card opens the viewer.

### Conversation
List pane: title, search, **New** (+), filter All / Work / ★ Gates, rows with avatar or ★, title, last message, time. Thread pane (chat): bar with back (phone), ★ for gates, title (double-click to rename), participants as stacked avatars, invite, details, archive; messages as bubbles with avatar, name, AI tag, time (mine tinted, agents outlined), provenance folded, side threads in place, launch proposal and run cards inline; composer with `@agent` and `/workflow` chips and a send button. A gate conversation pins the **gate flow** at the top. Details panel (toggle): workspace, subject, participants, runs. New conversation: title, intent, chips, "Use the scenario", Start.

### Gate flow (shared)
Four steps: **Gate raised → Review the artifact → Decide → Finalized**. In the gate conversation: "Open the artifact" (viewer over the thread) then the decision (approve, approve with reservation, reject with a comment); after the decision: who, when, comment, what happens next, links to the artifact, the run and the conversation. Elsewhere: the state and the way to the conversation ("Decide in the gate conversation" for holders, "Open the gate conversation" otherwise).

### Supervision › Gates
Bar: status (All / Pending / Decided) and my role (Any / I decide / I requested / I take part). Gates waiting for the user as flows first; then the table (gate, artifact → viewer, run, status, my role, decided by, when, Decide / Open → conversation).

### Supervision › Runs
Bar: Runs / Statistics; status (All / Active / At a gate / Done / Failed) and my role; pause or resume. KPI strip (active runs, sessions with agents and humans involved, tokens, AI cost, time at work and waiting). Rows: live status glyph, workflow and instance, subject, current step, progress (shimmering while active), cost, duration, tokens, gates ★, status → run. Statistics: one card per subject end to end (timeline work / gate wait, by workflow, by agent, by model), then by workflow for all subjects (cost per accepted artifact).

### Supervision › Run
Left: Overview, the orchestrator session, one worker session per step (status glyph, actor, model, cost). Centre: for a session, agent, model, tokens and cost, time; the step's status, artifact (viewer), commit, harness verdicts; **Session log** (harness journal entries); **Join the conversation** for the orchestrator. Overview: KPIs, gates as flows, failure, launch facts. Cancel while active.

### Supervision › Organization
Proposals (change, upgrade, rollback, to Poesis: each opens a conversation); indicators of what the organization declares as clickable tiles (explorer folders, viewer for configuration files, board, runs); gates and holders; agents (click → agent file in the viewer); where it lives (folder, nominal import, gap, harness); the SAF workflows to create; history (click → first changed file).

## Journeys (smoke walk `app/tools/smoke.mjs`)

| Journey | Steps | Evidence |
| --- | --- | --- |
| Explore and read | Explorer root → art/platform/program-backlog/… → Feature in the viewer → versions → raw → organization/conf/workspace.conf.yaml as a tree | F5-AC6, F5-AC9, F16-AC1 |
| Launch from an intent | Conversation › New → scenario → Start → AI notice → proposal → Confirm and launch | F1-AC3, S7-AC1, F17-AC2 |
| Gate journey | gate raised (system message, bell) → gate conversation → Open the artifact (viewer) → Decide → Reject with a comment → finalized; Supervision › Gates → second gate → review → Approve | S7-AC2, S7-AC3, F4-AC3, S22 |
| Follow runs | Runs list with cost and time → Statistics → run → worker session → session log | F18-AC2, F1-AC4, R14 |
| Board and Organization | Board → card in the viewer; Organization → agent file in the viewer | F5-AC1, S61 |
| Consult, out of scope, small screens | consultation threads, no free chat; tablet and phone captures | F1-AC9, F1-AC7 |

## Open UX points
- Worker sessions have no conversation of their own in the mock: they expose their log; the orchestrator's conversation is the launching one.
- Subject of a run derived from its artifacts; a run input naming it would be more robust.
- Price list fictitious until the Poesis Models Gateway publishes its list.
- Mermaid in Markdown not rendered yet (safe renderer needed); wording of the AI notice to validate.
