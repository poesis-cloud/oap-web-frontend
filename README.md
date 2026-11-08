# SAI Web Frontend

[![CI](https://github.com/poesis-cloud/oap-web-frontend/actions/workflows/ci.yaml/badge.svg)](https://github.com/poesis-cloud/oap-web-frontend/actions/workflows/ci.yaml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

The web application of **SAI (Systemic Agentic Interface)**: a collaborative workspace of humans and
agents working in framed, auditable SAF workflows to deliver quality artifacts (affordance
[poesis#40](https://github.com/poesis-cloud/poesis/issues/40) R15, capability
[oap#1](https://github.com/poesis-cloud/oap/issues/1)). Part of the
[`oap`](https://github.com/poesis-cloud/oap) solution. Three surfaces, one menu: **Workspace**
(the artifacts, laid out as the SAF organization's workspace map, previewed read-only),
**Conversations** (humans and agents building those artifacts; ★ gates open validation
conversations), **Supervisor** (what waits for you, runs, activity, budget).

## Structure

```
def/            # design-time material: architecture, UX model, SAF integration boundary, security, testing, ADRs
app/            # the Angular 21 + PrimeNG + Tailwind application, developed against five mocked backends
```

## Status

Frontend mock (2026-11-08): the three surfaces run locally over in-browser mocks of the five
backends, workspace manager, conversation manager, agent runtime (SAF harness lifecycle
replayed, scripted agents, no model called), PIS IAM (Keycloak) and the model gateway (Azure AI
Foundry). Each mock sits behind one port (`def/adr/ADR-007-mocked-backends.md`); the UI stack is
the one of `oip-web-frontend` (`def/adr/ADR-006-oip-ui-stack.md`). See `app/README.md` to run
and verify, `def/README.md` for the documents.

Deployment assets and the build pipeline will be added as the product is implemented.

<!-- roadmap:start -->
## Roadmap

![Roadmap](docs/roadmap.svg)

<!-- roadmap:end -->
