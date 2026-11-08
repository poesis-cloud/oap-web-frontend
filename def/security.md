# SAI Web Frontend — security model (slice 1, 2026-11-08)

Security is a design condition. This note records the threat model of the frontend slice (STRIDE over the trust boundaries), the controls in place, and what is explicitly **not** secured yet. References: OWASP Top 10 (2021), OWASP Top 10 for LLM Applications (2025), OWASP ASVS 4.0 (levels noted), affordance rules R4, R5, R6, R9, R12, R15.

## Trust boundaries

```
Browser (untrusted client) ── PIS OIDC (identity) ── oap-web-backend (store, usage, admin)
                           └─ oap-agent-runtime (harness, hosted workspaces) ── model source (gateway or tenant endpoint)
Workspace content (agent-authored, untrusted data) ──► rendered read-only in the browser
```

Slice 1 runs entirely in the browser with in-memory adapters: there is no network call, no credential, no persistence. The controls below are those the core enforces regardless of adapter, plus the browser-side hardening.

## Threat model (STRIDE, selected)

| Threat | Boundary | Control in slice 1 | Status |
| --- | --- | --- | --- |
| Spoofing: an agent confirms a launch or decides a gate | application core | `confirmProposal` and `decideGate` take a human session; agents have no session. Tests F17-AC2, F4-R3 | enforced |
| Tampering: a view writes to the workspace | core / ports | views only receive `WorkspaceReadPort`; writes exist only on the runtime adapter (F17-R6, F5-R1) | enforced |
| Tampering: artifact content injects markup or script | artifact viewers | Markdown rendered from a parsed block model through templates, never `innerHTML`; raw view in `<pre>`; CSP forbids inline scripts | enforced |
| Repudiation: who decided, who wrote | workspace history | every commit names its acting session, run and step; gate decisions carry the human, time and reviewer seconds; journal append-only (C8 enforced in the repository) | enforced |
| Information disclosure: cross-tenant read | core | tenant check on every read and command; identical "not accessible" answer for missing and foreign resources (F17-R7, F14-R6); tests F17-AC7 | enforced |
| Information disclosure: non-participant reads a conversation | core | participant check (F1-R4); invitation requires membership (F17-R3) | enforced |
| Denial of service: runaway agent cost | runtime | per-tenant token budget with alert and hard stop (F3, F4-R4); test F4-AC4 | enforced (demo values) |
| Elevation: a member without the gate role approves | core | role check against PIS-projected roles (F4-R3) | enforced |
| LLM01 Prompt injection through workspace files or tool output | model source / harness | out of scope for slice 1 (no model call). Design: harness authorization and commit gate bound what an injected instruction can do; tool allow-lists per organization (F4-R5); content is data, never instructions | **not secured, not exercised** |
| LLM02 Sensitive information disclosure to a model | model source | out of scope (no model call). Design: EU-only by default, tenant allow-list, logged opt-in for tenant endpoints (R4, R5); browsers never call providers | **not implemented** |
| LLM06 Excessive agency | harness | the harness alone sequences steps; no agent selects steps; human ★ gates never auto-approve (R3, F4-R3) | mirrored in the demo runtime |
| Supply chain (A06) | build | eight runtime dependencies, all Angular/rxjs/tslib; no UI library; fonts self-hosted; fixtures generated from reviewed repositories | enforced |
| Secrets in the repository | repo | none; pre-commit guard scans for secret patterns; `.env*` never committed | enforced |

## Browser-side hardening

- Content-Security-Policy meta: `default-src 'self'`, `script-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`; `style-src 'unsafe-inline'` is required by Angular component styles and should move to nonces when served with headers. `frame-ancestors` (clickjacking) cannot be expressed in a meta element: the serving instance must add it as an HTTP header, `'none'` for the standalone instance and the OIP origin for the embedded widget (F11).
- `referrer: no-referrer`, `robots: noindex`.
- No `localStorage`/`sessionStorage` use: the AI-notice acknowledgement and all state live in memory for the session (the backend will persist the acknowledgement per user).
- Typed, understandable errors shown to the user; no raw error or blank state (S1-AC4).

## Not secured yet (explicit)

- **Authentication and authorization are simulated**: the "acting as" switch exists only to demonstrate role-based gates. Production uses PIS OIDC with Organization and Membership claims (R9) and server-side checks in `oap-web-backend` and `oap-agent-runtime`; the frontend checks are a UX convenience, never the guarantee.
- **No transport, session or token handling** in slice 1.
- **File attachments** (F1-R8, S14) are not implemented; the scanning and size limits belong to the backend.
- **Audit export, retention and erasure** (F8, R12) are not implemented.

## ASVS mapping (frontend-relevant, level 1 unless noted)

| ASVS | Item | Slice 1 |
| --- | --- | --- |
| V4.1 | Access control enforced on a trusted service layer | mirrored in the core; real enforcement is backend/runtime work |
| V5.3 | Output encoding, no dynamic HTML | met (template rendering, no `innerHTML`) |
| V7.1 | Logs do not contain secrets | journal and usage records carry ids and counts only |
| V8.3 | Sensitive data not stored client-side | met (no browser storage) |
| V14.4 | CSP, referrer policy | met (meta; headers recommended) |

## Review cadence

Re-run this note at each slice. Before any production deployment: a threat model with the backend and runtime owners (prompt injection, tool abuse, repo credentials), a DPIA (CAP-A5), and the AI Act register (CAP-A6).

## Addendum 2026-11-08 (evening): stack change

- Dependencies: PrimeNG 21, `@primeuix/themes`, primeicons, Tailwind 4 (`@tailwindcss/postcss`, postcss) and Prettier join the tree (OIP stack, ADR-006). The supply-chain surface grows accordingly; versions are the ones `oip-web-frontend` already ships.
- Rendering: PrimeNG and Tailwind inject styles; the CSP keeps `style-src 'self' 'unsafe-inline'` as before. No `innerHTML` was introduced: the YAML/JSON viewer renders a parsed tree through templates, and the YAML reader never evaluates content.
- `public/runtime-config.js` is a static script (same mechanism as OIP) read at start; it carries URLs only, never secrets.
- Mocks: `MockKeycloak` holds no credential and no token; the "acting as" switch exists only in mock mode and must disappear from live builds (open item).
