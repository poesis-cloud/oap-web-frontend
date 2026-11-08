---
id: SAI-FE-ADR-002
title: UI kit and styling of the SAI web application
status: superseded
superseded_by: SAI-FE-ADR-006
product: oap-web-frontend
decision_scope: UI component library, styling approach, theming
deciders:
  - Clément Cazaud (maintainer)
created: 2026-11-08
decided: null
---

# SAI-FE-ADR-002 — UI kit and styling

## Context
SAI's interface must stay minimalist, fast and comfortable for a full working day (poesis#40 R15 "minimalist interface first"). `oip-web-frontend` uses PrimeNG and Tailwind 4. SAI will be embedded in OIP (F11), so its styles must not leak into or depend on the host. The workstation that builds slice 1 has little disk; every dependency is also a supply-chain surface (OWASP A06).

## Decision scope
Whether SAI uses a component library (PrimeNG) and a utility framework (Tailwind) or hand-written design tokens with plain CSS. Not in scope: iconography and illustration.

## Option evaluation criteria

| Criterion | Why it matters | Weight | Reading |
| --- | --- | --- | --- |
| Visual control for a premium, calm UI | The product is sold on simplicity | H | higher is better |
| Dependency surface | Security reviews, upgrades, bundle size | M | higher is better (smaller) |
| Consistency with OIP | Same look when embedded | M | higher is better |
| Delivery speed for slice 1 | Small team | M | higher is better |

## Options evaluation

| Option | Visual control | Dependency surface | Consistency with OIP | Delivery speed | Summary assessment |
| --- | --- | --- | --- | --- | --- |
| A. Design tokens in CSS custom properties, plain CSS per component, no UI library | 5 | 5 | 3 (tokens can be mapped onto PrimeNG theme variables later) | 4 | **Chosen for slice 1** |
| B. PrimeNG + Tailwind 4 like OIP | 3 | 2 | 5 | 4 | Deferred: revisit for F11 embedding |
| C. Tailwind only | 4 | 3 | 4 | 4 | Not chosen: utility classes in templates reduce readability of a minimalist UI |

## Decision
Use hand-written design tokens (`src/styles.css`: colour, radius, shadow, typography, light and dark schemes) and small scoped component styles. Self-host the two fonts (Hanken Grotesk, JetBrains Mono, both SIL OFL) so that no request leaves the instance. Revisit PrimeNG when the OIP embedding (F11) is designed; the token names are the mapping surface.

## Formal specification of the selected option
- Tokens are defined once on `:root` and redefined under `prefers-color-scheme: dark`.
- Components use semantic classes (`.btn`, `.card`, `.badge-*`, `.fold`) and never inline colours.
- Every interactive element is a native `button`, `a`, `select` or `textarea` with visible focus.
- Status colours carry meaning through text as well (badges show the status word), never colour alone.

## Consequences
- A design review with the OIP frontend owner before F11 to align tokens.
- No icon library in slice 1; glyphs are text, replaced later if needed.

## Implementation hooks
`app/src/styles.css`, `app/public/fonts/`, component `styles` blocks.
