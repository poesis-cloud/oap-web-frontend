# OAP Web Frontend — design-time definitions

Design-time material for the SAI web application: product study, screen mockups, and design
references. The main [README](../README.md) stays short and points here.

## Documents

| Document | Content |
| --- | --- |
| [architecture.md](architecture.md) | boundaries of responsibility, sources of truth, layers, flows of slice 1 |
| [ux-model.md](ux-model.md) | views, navigation and user journeys (CAP-A13 draft) |
| [saf-integration.md](saf-integration.md) | what SAF provides, mapping of harness functions to the views, what slice 1 simulates |
| [security.md](security.md) | threat model, controls, what is not secured yet |
| [testing.md](testing.md) | test levels, acceptance traceability, results |
| [deployment.md](deployment.md) | how to put the mock online for team previews: checked facts (GitHub Free plan, private repository), options, recommendation (Azure Static Web Apps Free), the preview workflow |
| [adr/](adr/) | ADR-001 stack · ADR-002 (superseded) · ADR-003 core and ports · ADR-004 SAF contracts · ADR-005 (superseded) · **ADR-006 OIP UI stack** · **ADR-007 mocked backends** · **ADR-008 Organization surface, gates as conversations, cost and time** · **ADR-009 desktop-like frame: explorer with viewer, chat, Supervision** · **ADR-010 sessions are conversations, gates are messages, Poesis identity** · **ADR-011 organization learning loop, decisions as messages, small-screen navigation** |

Normative sources are the GitHub issues: affordance poesis#40, capability oap#1 and its features, saf#6; plus Clément's directions of 2026-11-08 and his UX feedback of 2026-11-09 (desktop-like application: Workspace with Explorer and Board, Conversation, Supervision with Gates, Runs and Organization; generic viewer; gate journey; mocked backends, OIP stack, Specialized SAFe configuration first, decisions are gates and gates are conversations, cost and time of runs, statistics). The product name in the UI is Organization Agentic Platform (OAP); SAI remains the name of the capability in the issues. These documents derive from them.
