# OAP Web Frontend — putting the mock online for team previews (2026-11-08)

Question from Nicolas (2026-11-08): how do we put this mock online so that the team tests it in a browser, in a test environment under `poesis.cloud`, without a hosting provider; can GitHub Pages do it, as for the PIS corporate site and the docs?

## Update, 2026-11-08 21:33: the repository became public

`gh api repos/poesis-cloud/oap-web-frontend` reported `visibility: private` at 20:55 and `visibility: public` from 21:33 (the other `oap-*` repositories stay private). Consequences:

- **GitHub Pages is now available on this repository on the Free plan** (public repository). An admin enables it once (Settings → Pages → Source: *GitHub Actions*; the `github-pages` environment must allow the branch `Nicolas`), then the workflow job `pages` deploys the build to `https://poesis-cloud.github.io/oap-web-frontend/` (`base_href=/oap-web-frontend/`), or to `https://oap-preview.poesis.cloud/` with a `CNAME` at GoDaddy. This is the simplest answer to the original question, and it stays in the product repository.
- The preview is as public as the code; the privacy argument of the table below no longer applies to this repository.
- The workflow file lives under `def/ci/preview.yaml` until a token with the `workflow` scope moves it to `.github/workflows/` (the push of 2026-11-08 was refused for that file with the current token).

## Deploy from this repository (decision of Nicolas, 2026-11-08 21:45): checklist

Everything is in the branch `Nicolas`; three one-time actions remain, none of which the assistant's account or token can do (`namasa-web` has push, not admin; the `gh` token has no `workflow` scope; the attempts were refused on 2026-11-08):

1. **Enable Pages** (repository admin, e.g. Clément): Settings → Pages → Build and deployment → Source: **GitHub Actions**. Then Settings → Environments → `github-pages` → Deployment branches: add **`Nicolas`** (the environment is created restricted to the default branch).
2. **Put the workflow in place** (Nicolas, 30 seconds):
   ```bash
   source /Users/namasa/Projects/Poesis-Project/.tools/poesis-env.sh
   gh auth refresh -h github.com -s workflow            # one-time: adds the workflow scope to the token
   cd /Users/namasa/Projects/Poesis-Project/POESIS-SAI/oap-web-frontend
   git mv def/ci/preview.yaml .github/workflows/preview.yaml
   git commit -s -m "ci: preview workflow in place" && git push origin Nicolas
   ```
3. **Deploy**: Actions → `oap-frontend-preview` → Run workflow → branch `Nicolas`, `deploy = pages`, `base_href = /oap-web-frontend/`. The site answers at **`https://poesis-cloud.github.io/oap-web-frontend/`** (deep links work: the build copies `index.html` to `404.html`). For `https://oap-preview.poesis.cloud/`: Settings → Pages → Custom domain, and a `CNAME oap-preview → poesis-cloud.github.io` at GoDaddy; then redeploy with `base_href = /`.

After step 2, every push of `Nicolas` verifies and builds the branch and keeps the site as the artifact `oap-frontend-preview`; to redeploy Pages on every push, change the `pages` job condition from `workflow_dispatch` to `push` (one line).

## Facts checked on 2026-11-08 at 20:55 (read-only, `gh api`, `dig`)

| Fact | Value | Consequence |
| --- | --- | --- |
| `poesis-cloud` organization plan | **Free** | GitHub Pages is available only for **public** repositories on this plan |
| `oap-web-frontend` visibility | **private** at 20:55, **public since 21:33**; Pages not enabled; `namasa-web` has push but not admin | Pages is possible since the change; an admin enables it |
| `pis-corporate-site` | **public**, Pages through a workflow, custom domain `poesis.cloud` | This is why Pages works there |
| `poesis.cloud` DNS | GoDaddy name servers, apex `A` records to GitHub Pages | A sub-domain (`CNAME`) can point anywhere |
| GitHub Pages access control | Enterprise Cloud only | Even with a paid plan a Pages site is reachable by anyone who has the URL |

The mock bundles the SAF organization sources (Apache-2.0, public repositories) and the OAP concepts of the private issues. The rule of this workstream is that SAI/OAP work stays in private `poesis-cloud` repositories. A public URL is therefore a decision for Nicolas and Clément, not a default.

## What the branch provides already

- `app/` builds as a static site that works at a domain root or under a sub-path (`ng build --base-href /oap-web-frontend/`): relative asset URLs, fonts bundled, SPA fallback (`404.html` copy for Pages, `staticwebapp.config.json` for Azure).
- `def/ci/preview.yaml` (to move to `.github/workflows/` with a `workflow`-scoped token) on the branch `Nicolas`: on every push, clean install (`npm ci`), type check, unit tests, production build, and the site uploaded as the workflow artifact **`oap-frontend-preview`** (members download it from the run page and serve it locally with any static server, for 14 days).
- Two **manual** deployment jobs (`workflow_dispatch`, input `deploy`): `pages` and `swa`. They stay inert until someone runs them on purpose.
- `tools/smoke.mjs --dist dist-subpath --base /oap-web-frontend` walks the built site under a sub-path, to prove the hosting layout.

## Options, with what each needs

| Option | Private? | Cost | One-time setup | Fits "test environment under poesis.cloud" |
| --- | --- | --- | --- | --- |
| **A. Azure Static Web Apps, Free tier** (recommended) | yes: built-in GitHub or Entra ID sign-in, invitations by role (up to 25 users on Free) | 0 € | create the Static Web App in the Poesis Azure subscription (~10 min), put its deployment token in the repository secret `AZURE_STATIC_WEB_APPS_API_TOKEN`, add `CNAME oap-preview.poesis.cloud` at GoDaddy and validate the custom domain | yes: `https://oap-preview.poesis.cloud`, EU region available |
| B. GitHub Pages on this repository | no (URL reachable by anyone; unlisted) | GitHub Team, ~4 $/user/month | upgrade the plan, enable Pages with source "GitHub Actions" (admin), run the workflow with `deploy=pages` and `base_href=/oap-web-frontend/`, optional `CNAME oap-preview.poesis.cloud` | partly: public |
| C. Publish the build inside `pis-corporate-site` (public Pages) | no | 0 € | copy `dist/` under a folder of that site, e.g. `https://poesis.cloud/oap-preview/` | partly: public, mixed with the corporate site |
| D. Cloudflare Pages + Cloudflare Access | yes (Access, 50 users free) | 0 € | Cloudflare account, project, Access policy, `CNAME` at GoDaddy | yes, but adds a provider Poesis does not use today |
| E. Local preview | yes | 0 € | `npm ci && npm start` on the branch | no URL for the team |

Recommendation (written while the repository was private): **A**. Since the repository is public, **B without the plan upgrade** (GitHub Pages on this repository, free) is the simplest; A remains the private option. Poesis already runs on Azure (PIS, Azure AI Foundry); the Free tier is enough for a mock; sign-in by invitation keeps the preview private; the workflow job `swa` is ready and runs on demand, and can be switched to automatic on push once validated.

## Steps for Nicolas (option A)

1. Azure portal → Create → Static Web App: plan **Free**, region West Europe, deployment source **Other** (the workflow uploads a prebuilt site). Copy the **deployment token**.
2. Repository `poesis-cloud/oap-web-frontend` → Settings → Secrets and variables → Actions → `AZURE_STATIC_WEB_APPS_API_TOKEN` (an admin of the repository does this).
3. Actions → `oap-frontend-preview` → Run workflow → branch `Nicolas`, `deploy = swa`, `base_href = /`. The site answers on its `*.azurestaticapps.net` address, behind GitHub sign-in (`staticwebapp.config.json`: every route needs an authenticated user; invite testers from the portal, role `authenticated`).
4. Custom domain: Static Web App → Custom domains → add `oap-preview.poesis.cloud`; at GoDaddy add the `CNAME` the portal shows. Certificates are automatic.
5. To deploy on every push to `Nicolas`, change the job condition in `preview.yaml` from `workflow_dispatch` to `push` (one line), after the first manual run succeeded.

If the decision is a public URL instead (B or C), the only change is the target: the build is the same.

## Local check of the hosting layout

```bash
cd app && npx ng build --base-href /oap-web-frontend/ --output-path dist-subpath
node tools/smoke.mjs --dist dist-subpath --base /oap-web-frontend --out ../../evidence/smoke-subpath
```
