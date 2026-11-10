import { serializeFrontmatter } from '../../core/saf/frontmatter';

/**
 * Scripted content of the deterministic demo runtime.
 *
 * Nothing here is produced by a model: every artifact and every agent reply is a fixed
 * text, parameterized by the run inputs, so that the vertical slice is reproducible and
 * costs nothing. The UI labels every agent output accordingly ("demo runtime, scripted").
 * Artifact layouts follow the SAF templates (`saf-agentic-organization/templates/`).
 */

export interface ScriptContext {
  readonly product: string;
  readonly art: string;
  readonly featureSlug: string;
  readonly featureId: string;
  readonly featureTitle: string;
  readonly intent: string;
  readonly date: string;
  /** 1 on the first pass; incremented by each rework after a rejected gate. */
  readonly revision: number;
  readonly gateComment: string | null;
}

export const ADR_ID = 'ADR-7';
export const ADR_SLUG = 'subscriptions-api-security';

export interface ScriptedArtifact {
  readonly path: string;
  readonly content: string;
}

/** Token figures are scripted too: they stand for what usage attribution would record (F3). */
export const STEP_TOKENS: Record<string, { input: number; output: number }> = {
  'author-nfrs': { input: 5200, output: 1400 },
  'author-adr': { input: 9800, output: 2600 },
  'challenge-security': { input: 6100, output: 900 },
  'challenge-operability': { input: 5400, output: 700 },
  'challenge-feasibility': { input: 5000, output: 650 },
  'owner-rewrite': { input: 11200, output: 2100 },
};

export function scriptedArtifact(kind: string, ctx: ScriptContext, valid = true): ScriptedArtifact {
  switch (kind) {
    case 'nfr-list':
      return { path: `portfolio/products/${ctx.product}/nfr-list.md`, content: nfrList(ctx) };
    case 'adr':
      return {
        path: `portfolio/art/${ctx.art}/program-backlog/${ctx.featureSlug}/${ADR_SLUG}.adr.md`,
        content: adr(ctx, valid),
      };
    case 'security-review':
      return {
        path: `portfolio/art/${ctx.art}/program-backlog/${ctx.featureSlug}/${ctx.featureSlug}.security-review.md`,
        content: securityReview(ctx),
      };
    case 'operability-review':
      return {
        path: `portfolio/art/${ctx.art}/program-backlog/${ctx.featureSlug}/${ctx.featureSlug}.operability-review.md`,
        content: operabilityReview(ctx),
      };
    case 'feasibility-review':
      return {
        path: `portfolio/art/${ctx.art}/program-backlog/${ctx.featureSlug}/${ctx.featureSlug}.feasibility-review.md`,
        content: feasibilityReview(ctx),
      };
    case 'feature-enabler':
      return {
        path: `portfolio/art/${ctx.art}/program-backlog/${ctx.featureSlug}/${ctx.featureSlug}-architecture.feature-enabler.md`,
        content: `${serializeFrontmatter({ title: 'Architecture enabler disposition', status: 'not-needed', parentFeature: ctx.featureId, created: ctx.date })}\n\n# Architecture enabler disposition\n\nNo separate enabler is required in this scripted business-Feature scenario. The architecture links are recorded on ${ctx.featureId}.\n`,
      };
    case 'architecture-runway':
      return { path: `portfolio/products/${ctx.product}/architecture-runway.md`, content: architectureRunway(ctx) };
    default:
      return {
        path: `portfolio/art/${ctx.art}/program-backlog/${ctx.featureSlug}/${kind}.md`,
        content: generic(kind, ctx),
      };
  }
}

export function painPoint(
  ctx: ScriptContext,
  comment: string,
  runId: string,
  gateLabel: string,
  reviewedPath: string,
): ScriptedArtifact {
  const reviewed = reviewedPath.slice(reviewedPath.lastIndexOf('/') + 1);
  const slug = `${runId}-${gateLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-reservation`;
  const frontmatter = serializeFrontmatter({
    id: `PP-${slug}`,
    title: `Reservation at the ${gateLabel} on ${reviewed}`,
    status: 'open',
    sourceRun: runId,
    origin: 'workflow',
    layer: 'program',
    symptom: comment,
    impact: 'Human reservation requires follow-up.',
    owner: 'release-train-engineer',
    evidence: [`runs/${runId}.run.json`, reviewedPath],
    created: ctx.date,
  });
  return {
    path: `portfolio/art/${ctx.art}/improvement-backlog/${slug}/${slug}.pain-point.md`,
    content: `${frontmatter}\n\n# Pain point — reservation at the ${gateLabel}\n\n## Report\n${comment}\n\n## Evidence\n- Run \`${runId}\`\n- Artifact under review: \`${reviewedPath}\`\n\n## Next\nTo be triaged in the next retrospective (F16).\n`,
  };
}

function nfrList(ctx: ScriptContext): string {
  const frontmatter = serializeFrontmatter({ product: ctx.product, revised: ctx.date });
  return `${frontmatter}

# ${titleCase(ctx.product)} — NFR Register

| NFR | Category | Constraint (measurable) | Applies to | Verified by | Enabler? |
|---|---|---|---|---|---|
| NFR-01 | security | Every subscription endpoint requires OAuth 2.1 bearer tokens; scopes \`subscriptions:read\` / \`subscriptions:write\`; no anonymous route | ${ctx.featureId} | Security review + contract tests | — |
| NFR-02 | security | Tenant isolation enforced server-side on every query (tenant id from the token, never from the payload) | ${ctx.featureId} | Isolation tests (zero cross-tenant reads) | — |
| NFR-03 | performance | p95 < 250 ms for \`GET /subscriptions/{id}\`; p95 < 600 ms for list endpoints at 10k subscriptions per tenant | ${ctx.featureId} | Load test in staging | — |
| NFR-04 | reliability | Writes are idempotent through an \`Idempotency-Key\` header retained 24 h | ${ctx.featureId} | Contract tests | — |
| NFR-05 | compliance | Personal data limited to billing contact; retention 36 months after cancellation; export and erasure endpoints | ${ctx.featureId} | DPIA + erasure test | F-14 |
| NFR-06 | observability | Every request carries a correlation id; audit log for create, change and cancel | ${ctx.featureId} | Log assertions | — |

Categories: security · performance · reliability · scalability · usability · maintainability · observability · compliance.
`;
}

/** What the scripted ADR says about the Feature it serves (the seeded backlog has three). */
const FEATURE_FACTS: Record<string, { readonly scope: string; readonly context: string }> = {
  'customer-subscriptions-api': {
    scope: 'authentication, authorization and tenant isolation of the subscriptions API',
    context:
      'it exposes customer subscriptions to partner applications and to the customer portal, across tenants, under GDPR',
  },
  'partner-sandbox': {
    scope: 'isolation and credentials of the partner sandbox, reusing the subscriptions API decision',
    context:
      'it opens the subscriptions API to partners on synthetic data, with the same tenant isolation as production and self-service credentials',
  },
  'subscription-invoicing-export': {
    scope: 'transport and reconciliation of the monthly invoicing export',
    context: 'it moves every subscription change of a closed month to the invoicing system, per tenant, exactly once',
  },
};

function factsOf(ctx: ScriptContext) {
  return FEATURE_FACTS[ctx.featureSlug] ?? FEATURE_FACTS['customer-subscriptions-api'];
}

function adr(ctx: ScriptContext, valid: boolean): string {
  const facts = factsOf(ctx);
  const base: Record<string, string | number | boolean | null | string[]> = {
    id: ADR_ID,
    title: ctx.featureTitle,
    product: ctx.product,
    parentFeature: ctx.featureId,
    decision_scope: facts.scope,
    deciders: ['central-supervisor', 'SE-Architect'],
    consulted: ['SE-Security', 'SE-DevOps-CI'],
    created: ctx.date,
    decided: null,
    supersedes: null,
    superseded_by: null,
    related_adrs: [],
    dependsOn: [],
    revision: ctx.revision,
  };
  if (valid) base['status'] = 'proposed';
  const frontmatter = serializeFrontmatter(base);
  const revisionNote =
    ctx.revision > 1 && ctx.gateComment
      ? `\n> Revision ${ctx.revision} — reworked after the ★ Architecture Gate comment: "${ctx.gateComment}".\n`
      : '';
  return `${frontmatter}

# ${ADR_ID} — ${ctx.featureTitle}
${revisionNote}
## Context
${ctx.intent}. The Feature ${ctx.featureId} is structurant: ${facts.context}. The forces are tenant isolation, partner integration simplicity and the operating cost of the authorization layer.

## Decision scope
This ADR governs ${facts.scope}. Data modelling and billing rules are separate decisions.

## Linked enablers and served artifacts
- Enabler follow-up: F-14 (personal data export and erasure endpoints)
- Served artifacts/specifications: \`portfolio/products/${ctx.product}/nfr-list.md\` (NFR-01, NFR-02, NFR-04)
- Companion references absorbed here: NFR register security rows

## Option evaluation criteria

| Criterion | Why it matters for this decision | Weight | How to read the score |
| --- | --- | --- | --- |
| Isolation strength | A cross-tenant read is the worst outcome | H | higher is better |
| Partner onboarding effort | Partners integrate without Poesis support | M | higher is better |
| Operating cost | The gateway is shared infrastructure | M | higher is better |

## Options evaluation

| Option | Isolation strength | Partner onboarding effort | Operating cost | Summary assessment |
| --- | --- | --- | --- | --- |
| A. API keys per partner | 2 — keys leak, no scoping | 4 — trivial | 4 — none | Rejected: no tenant binding |
| B. OAuth 2.1 client credentials with tenant-bound scopes${ctx.revision > 1 ? ' and mandatory mTLS for partners' : ''} | 5 — tenant in the token, verified by the gateway | 3 — standard libraries | 3 — gateway policies | **Chosen** |
| C. Signed requests (HMAC) | 4 | 2 — bespoke | 4 | Not standard for partners |

1. **Option A** — simplest, but an API key cannot carry a verified tenant claim.
2. **Option B — chosen** — tokens carry \`tenant_id\` and scopes; the gateway validates them; the service re-checks the tenant on every query (NFR-02).
3. **Option C** — strong but non-standard; partner effort is too high.

## Decision
Use OAuth 2.1 client-credentials tokens issued by the platform identity provider, with tenant-bound scopes validated at the API gateway and re-verified by the service on every data access.${
    ctx.revision > 1
      ? ' Partner clients additionally present a client certificate (mTLS); the gateway binds the certificate thumbprint to the client id.'
      : ''
  }

## Formal specification of the selected option
- Token: JWT, \`aud=subscriptions-api\`, claims \`tenant_id\`, \`scope\`; lifetime 10 minutes.
- Gateway policy: validate signature, audience, expiry; reject tokens without \`tenant_id\`.
- Service: every repository query is filtered by the token's \`tenant_id\`; a mismatch between path and token returns 404, never 403, to avoid tenant enumeration.
- Idempotency: \`Idempotency-Key\` required on POST and PATCH (NFR-04).
- Audit: create, change and cancel events with correlation id (NFR-06).

## Consequences
- Follow-up Feature F-14 for export and erasure endpoints.
- Partners need a client registration flow (operator runbook).

## Implementation hooks
Repos and code areas impacted: \`customer-platform-api\` (auth middleware, repositories), \`platform-gateway\` (token policies).
`;
}

function securityReview(ctx: ScriptContext): string {
  const frontmatter = serializeFrontmatter({
    id: `${ctx.featureSlug}-security-review`,
    subject: `portfolio/art/${ctx.art}/program-backlog/${ctx.featureSlug}/${ADR_SLUG}.adr.md`,
    reviewer: '@security-expert',
    verdict: ctx.revision > 1 ? 'pass' : 'concerns',
    created: ctx.date,
    findings: [],
    openItems: [],
  });
  return `${frontmatter}

# Security Review — ${ADR_ID}

## Subject under review
The authentication, authorization and tenant-isolation decision for the subscriptions API.

## Findings
| id | severity | finding | recommendation |
|---|---|---|---|
| F-01 | medium | Token lifetime of 10 minutes is adequate, but refresh handling for partners is unspecified | Document client-credentials renewal in the partner runbook |
| F-02 | ${ctx.revision > 1 ? 'low' : 'medium'} | ${
    ctx.revision > 1
      ? 'mTLS binding closes the token-replay concern raised at the gate'
      : 'A leaked partner token can be replayed from any network location until expiry'
  } | ${ctx.revision > 1 ? 'None' : 'Consider mTLS or DPoP for partner clients'} |
| F-03 | low | 404-on-mismatch is correct; ensure logs still record the attempt | Audit event on tenant mismatch |

## Verdict
**${ctx.revision > 1 ? 'PASS' : 'CONCERNS'}** — ${ctx.revision > 1 ? 'no blocking security concerns.' : 'non-blocking issues recorded as openItems for the owner rewrite.'}

## Recommendations
Owner: @system-architect. Target: before the ★ Architecture Gate.
`;
}

function operabilityReview(ctx: ScriptContext): string {
  const frontmatter = serializeFrontmatter({
    id: `${ctx.featureSlug}-operability-review`,
    subject: ADR_ID,
    reviewer: '@operator',
    verdict: 'pass',
    created: ctx.date,
  });
  return `${frontmatter}

# Operability Review — ${ADR_ID}

## Subject under review
Gateway policies and service-side isolation checks for the subscriptions API.

## Findings
| id | severity | finding | recommendation |
|---|---|---|---|
| O-01 | low | Gateway policy changes need a rollout runbook per environment | Add to the release-on-demand checklist |
| O-02 | low | Correlation id propagation must survive the gateway hop | Verify with the OTel collector |

## Verdict
**PASS** — deployable with the standard pipeline; two runbook additions.
`;
}

function feasibilityReview(ctx: ScriptContext): string {
  const frontmatter = serializeFrontmatter({
    id: `${ctx.featureSlug}-feasibility-review`,
    subject: ADR_ID,
    reviewer: '@developer',
    verdict: 'pass',
    created: ctx.date,
  });
  return `${frontmatter}

# Feasibility Review — ${ADR_ID}

## Subject under review
Implementation effort of tenant-bound OAuth 2.1 tokens and idempotent writes.

## Findings
| id | severity | finding | recommendation |
|---|---|---|---|
| D-01 | low | Idempotency-Key storage needs a 24 h TTL store | Reuse the existing cache |
| D-02 | low | Repository filters by tenant can be centralized in one interceptor | One shared base repository |

## Verdict
**PASS** — about two Stories of work; no blocking unknown.
`;
}

function architectureRunway(ctx: ScriptContext): string {
  const frontmatter = serializeFrontmatter({ product: ctx.product, revised: ctx.date, adrs: [ADR_ID] });
  return `${frontmatter}

# ${titleCase(ctx.product)} — Architecture Runway

## Runway items
| Item | Serves | Decision | Status |
|---|---|---|---|
| Tenant-bound OAuth 2.1 tokens at the gateway | ${ctx.featureId} | ${ADR_ID} | ready for the ★ Architecture Gate |
| Shared tenant-filtering repository base | ${ctx.featureId} | ${ADR_ID} | ready |
| Idempotency store (24 h TTL) | ${ctx.featureId} | ${ADR_ID} | ready |

## Challenge outcomes absorbed
- Security: ${ctx.revision > 1 ? 'mTLS binding for partner clients added (revision ' + ctx.revision + ')' : 'token replay concern recorded as an open item'}.
- Operability: runbook additions for gateway policies and correlation ids.
- Feasibility: two Stories, no blocking unknown.
`;
}

function generic(kind: string, ctx: ScriptContext): string {
  const frontmatter = serializeFrontmatter({ id: `${ctx.featureSlug}-${kind}`, status: 'draft', created: ctx.date });
  return `${frontmatter}\n\n# ${titleCase(kind)}\n\nScripted demo content for ${ctx.featureId}.\n`;
}

export function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Scoped demo replies: do not invent a decision, an estimate or a handoff for unrelated topics. */
const onApi = (topic: string) => /api|tenant|token|oauth|subscription|mtls|replay/i.test(topic);
export const SPECIALIST_ANSWERS: Record<string, (topic: string) => string> = {
  'system-architect': (topic) =>
    onApi(topic)
      ? 'For the API scenario, I own the NFR register and ADR. Separate authentication, authorization and tenant isolation from billing rules. The Architecture Gate holder decides; I do not approve my own design. Use /architectural-runway-extension to draft and challenge the decision.'
      : 'I author architecture decisions and NFRs. Name the Feature, constraints and decision to compare; I cannot infer an API design from this request.',
  'security-expert': (topic) =>
    onApi(topic)
      ? 'For this API, review tenant enumeration, token replay and scope breadth. mTLS can bind a partner client to its token. I author a security challenge packet; System Architect owns the ADR and the human gate holder decides.'
      : 'I review security risks and trust boundaries. Name the artifact, assets and threat you want reviewed; I do not author or approve the owner’s decision.',
  developer: (topic) =>
    onApi(topic)
      ? 'I review implementation feasibility: token validation, tenant filters and an idempotency store. An effort estimate needs repository evidence; this demo has none. System Architect owns the ADR.'
      : 'I handle implementation and feasibility. Provide the Story or artifact and repository context; there is not enough evidence here to estimate the work.',
  operator: (topic) =>
    onApi(topic)
      ? 'I review gateway rollout, certificate rotation and correlation-id propagation. Those findings belong in the operability review; the owner incorporates them into the decision.'
      : 'I review deployability, runbooks and operations. Name the change and its operating environment so the review stays in scope.',
  'release-train-engineer': () =>
    'I coordinate program workflows and record one pain point per /improvement-backlog run. Name a Feature for architecture work, or open Improvement for a retrospective.',
  'scrum-master': () =>
    'I coordinate team work: Stories, iteration planning, retrospectives and verification. Name the team and Story, then choose the matching workflow; I do not own program architecture or portfolio decisions.',
  'value-management-officer': () =>
    'I coordinate portfolio work: Epics, lean business cases and investment planning. Name the Epic or investment decision; its owner drafts it and the designated gate holder decides.',
};
