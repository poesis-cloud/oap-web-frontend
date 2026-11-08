# OAP Web Frontend — Organization Agentic Platform

[![CI](https://github.com/poesis-cloud/oap-web-frontend/actions/workflows/ci.yaml/badge.svg)](https://github.com/poesis-cloud/oap-web-frontend/actions/workflows/ci.yaml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

The web application of the **Organization Agentic Platform (OAP)**, which delivers the SAI
capability: a collaborative workspace of humans and agents working in framed, auditable SAF
workflows to deliver quality artifacts (affordance
[poesis#40](https://github.com/poesis-cloud/poesis/issues/40) R15, capability
[oap#1](https://github.com/poesis-cloud/oap/issues/1)). Part of the
[`oap`](https://github.com/poesis-cloud/oap) solution. First target: the **Specialized
configuration serving the SAFe Agentic Organization** of SAF. Four surfaces, one menu:
**Workspace** (the artifacts, laid out as the organization's workspace map, previewed
read-only), **Organization** (everything in the SAF organization of the workspace, browsed
in its native formats, with how it evolves), **Conversations** (humans and agents building
the artifacts; a ★ gate is a conversation where the decision is taken), **Supervisor**
(gates, runs with their AI cost and time, end-to-end analysis by subject).

## Structure

```
def/            # design-time material: architecture, UX model, SAF integration boundary, security, testing, ADRs
app/            # the Angular 21 + PrimeNG + Tailwind application, developed against five mocked backends
```

## Status

Frontend mock (2026-11-08): the four surfaces run locally over in-browser mocks of the five
backends, workspace manager, conversation manager, agent runtime (SAF harness lifecycle
replayed, scripted agents, no model called), PIS IAM (Keycloak) and the model gateway (Azure AI
Foundry, with a fictitious price list so that runs show euros). Each mock sits behind one port
(`def/adr/ADR-007-mocked-backends.md`); the UI stack is the one of `oip-web-frontend`
(`def/adr/ADR-006-oip-ui-stack.md`); the Organization surface, gates decided in their
conversation, and cost and time of runs follow `def/adr/ADR-008-organization-surface-gates-cost.md`.
See `app/README.md` to run and verify, `def/README.md` for the documents.

Preview for the team: `.github/workflows/preview.yaml` builds the branch `Nicolas` on every push
and keeps the site as a downloadable artifact; putting it on a URL under `poesis.cloud` is a
one-time decision and setup described in `def/deployment.md` (recommended: Azure Static Web Apps
Free with sign-in). Deployment assets for the product itself will be added as it is implemented.

<!-- roadmap:start -->
## Roadmap

![Roadmap](docs/roadmap.svg)

<!-- roadmap:end -->
