---
id: SAI-FE-ADR-006
title: Reuse the OIP frontend stack (PrimeNG + Tailwind) — supersedes ADR-002
status: proposed
product: oap-web-frontend
decision_scope: UI component library, styling approach, theming
deciders:
  - Clément Cazaud (maintainer)
created: 2026-11-08
decided: null
supersedes: SAI-FE-ADR-002
---

# SAI-FE-ADR-006 — Reuse the OIP frontend stack

## Context
ADR-002 chose hand-written tokens and plain CSS for the first slice and deferred PrimeNG to the OIP embedding. On 2026-11-08 Clément asked to **reuse the same frontend technologies as OIP** and to keep the interface simple so that the mock frontend can be iterated quickly. `oip-web-frontend` runs Angular 21 LTS, PrimeNG 21 with the Aura preset (`@primeuix/themes`), primeicons, Tailwind 4 through `@tailwindcss/postcss`, Vitest, Prettier; its copilot instructions ask for minimal custom CSS and Tailwind responsive utilities in templates.

## Decision
Adopt the OIP stack: PrimeNG 21 (Aura) + Tailwind 4 + primeicons, Prettier with the OIP settings, `.postcssrc.json` as in OIP. Design tokens stay in one file (`src/sai-tokens.css`) with the **same names and the same indigo primary as OIP's `itip-tokens.css`** so that SAI, embedded in OIP (F11), reads as one product; SAI adds two accents (★ gate gold, AI violet) and status tones. Tailwind's `@theme` maps the tokens to utilities (`bg-surface`, `text-ink-muted`, `text-gate`…); a short PrimeNG bridge maps them to `--p-*` variables. Dark theme on `data-theme="dark"` (`ThemeService`, same pattern as OIP). Fonts stay self-hosted (OFL).

Layer order `theme, base, primeng, components, utilities` lets Tailwind utilities override PrimeNG component styles, which keeps component CSS near zero.

Deferred on purpose (KISS): Transloco i18n (English only until Q-I is decided), lucide icons (primeicons suffice), Cypress (the headless-Chrome smoke walk covers the journeys for now), Docker/Helm (added with the pipeline).

## Consequences
- Dependencies grow from 8 to 12 runtime packages; the initial bundle is ~940 kB raw / ~205 kB transferred (budgets raised to 1.2 MB warning / 2 MB error; OIP uses 700 kB / 1 MB).
- PrimeNG components used: Tree, Tabs, Select, Button, Tag, Avatar, Popover, Drawer, Dialog, Toast, Textarea, InputText, Tooltip. Everything else is Tailwind.
- A design review with the OIP frontend owner stays due before F11 (token names are already aligned).

## Implementation hooks
`app/src/styles.css`, `app/src/sai-tokens.css`, `app/src/app/app.config.ts` (`providePrimeNG`), `app/.postcssrc.json`, `app/.prettierrc`.
