---
id: OAP-FE-ADR-009
title: A desktop-like application frame — explorer like GitHub with a generic viewer, conversation like a chat, Supervision as Gates, Runs and Organization
status: proposed
product: oap-web-frontend
decision_scope: information architecture and interaction model of the frontend
deciders:
  - Clément Cazaud (maintainer)
created: 2026-11-09
decided: null
supersedes: null
---

# OAP-FE-ADR-009 — Desktop-like application frame

## Context
Clément's UX feedback on the first mock (2026-11-08 23:44, 2026-11-09 00:13 and 14:00): too dense, raw information, page headers that waste vertical space, a "site" feel. He wants a real, modern desktop-like application with airy, generic, consistent components; a workspace browser in editor style with a generic read-only **viewer** (title on top, grouped icon buttons for versions with a diff, raw source and discuss); Explorer and Board as collapsible sub-items of Workspace; the organization's indicators and proposals in Supervision and its files in the explorer; a conversation inspired by chat applications, listed right of the menu, named **Conversation**; **Supervision** with Gates, Runs (with statistics) and Organization; gates by status and by the user's role (gates are conversations); runs by status and role, animated when active, interactive (sessions, logs, models, tokens, artifacts); the gate journey (notification → gate → artifact review → validation → finalization) obvious at each step; no "mocked backends" notice in the menu; the whole application name; the Poesis logo. Then: the file hierarchy on the left and the current directory in the centre like GitHub; an artifact opens the viewer over the directory, which dims.

## Decision
1. **Frame.** A side menu with collapsible groups (Workspace: Explorer, Board; Conversation; Supervision: Gates, Runs, Organization), the Poesis logo and the full product name; a 44 px title bar with the location and the notifications; every feature fills the remaining height with one or more **panes** (list pane, content pane), each with a thin bar and its own scrolling. No page headers. Tablet: the menu becomes an icon rail; phone: a bottom bar and one pane at a time.
2. **Explorer like GitHub.** Tree on the left, current directory in the centre (folders first, expected slots greyed), breadcrumbs in the pane bar. A file opens the **viewer** as an overlay over the listing (backdrop dims it, Escape closes). The organization folder is browsed here like any other; unmapped folders sit at the tree root.
3. **Generic viewer** (`shared/viewer.ts`): title, path, status; a tool group with *Versions* (list of versions and a line **diff** against the previous one, `core/application/diff.ts`), *Raw* (`< >`), *Discuss*; close. Used as overlay by the explorer, the board, the gates, the runs, the organization and the chat.
4. **Conversation** as a chat: list pane (filters, search, new), thread pane with avatar bubbles, agents labelled AI with provenance, proposals and run cards inline, a composer with shortcuts, a details side panel. A gate conversation pins the **gate flow**.
5. **Gate flow** (`shared/gate-flow.ts`): four visible steps, *Gate raised → Review the artifact → Decide → Finalized*; the artifact opens in the viewer over the thread; the decision controls appear only in the gate conversation (`mode="decide"`); elsewhere the flow shows the state and leads to the conversation.
6. **Supervision.** *Gates*: by status and by the user's role (I decide, I requested, I take part), gates waiting for the user shown as flows first. *Runs*: by status and role, live rows (spinner, shimmering progress, current step), cost, time, gates; *Statistics* (totals in real time, subjects end to end, by workflow). *Run*: sessions on the left (orchestrator and one worker session per step), the selected session with model, tokens, cost, time, artifact (viewer), harness log, "join the conversation" for the orchestrator; gates as flows; cancel while active. *Organization*: proposals (conversations), indicators as clickable tiles (explorer or viewer), gates and holders, agents, the SAF workflows to create, history and gap to nominal.
7. **Chrome.** No "mocked backends" block: a `demo` chip in the title bar and the acting-as switch in the user menu. No arrow glyphs on buttons; labels in sentence case; icons from one quiet set (file glyphs drawn in `shared/icons.ts`).

## Consequences
- Old routes redirect (`/supervisor*`, `/conversations*`, `/organization*`, `/workspace/organization`).
- The smoke walk covers the new journeys (8 steps, 35 screenshots incl. tablet and phone).
- Open: the orchestrator and worker sessions have no conversation of their own in the mock (the orchestrator's is the launching conversation; workers expose their log); a run's subject is derived from its artifacts; the acting-as switch remains a demonstration device.
