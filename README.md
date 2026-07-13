# Forge Atlas

Forge Atlas is a truth-first AI operations interface. Omega 11.0 rebuilds the original collection of standalone pages as one maintainable Eleventy site with a single Cloudflare Worker API contract.

The public product has four explicit states:

- **Live** — a current server request completed successfully.
- **Local** — the feature runs only in the visitor's browser.
- **Demo** — curated editorial content; no provider call occurred.
- **Optional** — the feature activates only when its server-side binding is configured.

The repository is source-available. No reuse license has been granted yet; choose and add a license before describing the project as open source.

## What is included

- `/command/` — a deterministic metadata and indexability audit for public HTTPS pages.
- `/challenge/` — the rebuilt cinematic Fight Club, with equal prompts, registered contenders, exact provider/model labels, and local-only judging.
- `/swarm/` — rapid or full strategist → builder → critic → closer orchestration with engine and fallback labels.
- `/atlas-id/` — a browser-local operator profile with bounded JSON export/import and reset.
- `/arena/`, `/forum/`, and `/market/` — clearly labeled editorial or source-backed surfaces without fabricated users, purchases, or telemetry.
- `workers/api/` — one Worker for health, audits, model comparisons, and swarm missions.
- `config/platform.json` — the single public release, navigation, route, fighter, and role registry.

The historical `source-archives/project.zip` remains untouched for provenance. It is not part of the production build.

## Architecture

```text
config/platform.json
        ├── Eleventy templates → dist/ → Cloudflare Pages
        └── Worker registry → /api/* → provider adapters
                                      ├── Workers AI (default binding)
                                      ├── OpenAI (optional)
                                      ├── Anthropic (optional)
                                      └── Gemini (optional)
```

Static pages never contain provider credentials. Browser requests are same-origin. The API limits request bodies, validates origins, fails closed when its rate-limit binding is missing, and does not expose upstream error bodies. The site audit accepts public HTTPS targets only, revalidates every redirect, restricts size and content type, and never sends retrieved page HTML to a model.

## Local verification

Requirements: Node.js 22 or newer and npm.

```bash
npm ci
npm run check
```

`npm run check` builds all public routes, validates metadata/links/headers/redirects/secrets and JavaScript syntax, runs Worker contract tests, and fails on high-severity dependency advisories.

For static interface work:

```bash
npm run dev
```

For the production-shaped Pages preview after a build:

```bash
npm run build
npm run preview
```

For the standalone API Worker:

```bash
cp workers/api/.dev.vars.example workers/api/.dev.vars
npm run worker:dev
```

Keep placeholders in the example file. Put real credentials only in the ignored `.dev.vars` file or encrypted Cloudflare secrets.

## Provider configuration

Workers AI is the default and uses the `AI` binding plus `WORKERS_AI_MODEL`. The configured default is `@cf/zai-org/glm-4.7-flash`; the runtime returns the actual model name with each response.

Optional adapters require both an encrypted API key and an explicit server-side model name:

| Provider | Secret | Model variable |
| --- | --- | --- |
| OpenAI | `OPENAI_API_KEY` | `OPENAI_MODEL` |
| Anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` |
| Gemini | `GEMINI_API_KEY` | `GEMINI_MODEL` |

If an optional provider is not configured, the Worker may use Workers AI only when that binding is available, and the response marks the fallback. It never silently relabels one provider as another.

Provider implementations follow the current primary documentation:

- [Cloudflare Workers AI model and binding](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/)
- [OpenAI Responses API](https://developers.openai.com/api/reference/responses/overview/)
- [Anthropic Messages API](https://docs.anthropic.com/en/api/messages)
- [Gemini generateContent API](https://ai.google.dev/api/generate-content)

## Deployment

Deployment is intentionally separate from validation:

1. Run `npm run check`.
2. Review `git diff` and the generated route inventory.
3. Deploy `workers/api/wrangler.toml`; it binds the Worker to `forge-atlas.io/api/*`, Workers AI, and a 12-request-per-minute rate-limit namespace.
4. Deploy `dist/` to the existing Cloudflare Pages project.
5. Verify `/api/health`, `/command/`, `/challenge/`, `/swarm/`, headers, redirects, and the custom 404 on the production hostname.

Commands are available as `npm run worker:deploy` and `npm run pages:deploy`, but they are not run by CI and require authorized Cloudflare credentials. API keys must be added with encrypted Cloudflare secrets, never committed in Wrangler configuration.

## Security and operations

- The static CSP permits only same-origin scripts, styles, fonts, and API connections.
- HSTS, frame blocking, MIME sniffing protection, restrictive referrer and permissions policies, COOP, and CORP are defined in `src/static/_headers`.
- The Worker has bounded JSON, bounded upstream HTML, manual redirect validation, request IDs, safe errors, same-origin browser checks, and fail-closed rate-limit enforcement.
- Community writes and payment flows are disabled until authentication, persistence/moderation, and complete commercial terms exist.
- GitHub CI uses commit-pinned actions and read-only checkout credentials. Frogbot runs only against the trusted default branch with read-only repository access. Terraform can plan on a PR but cannot auto-apply.
- `.env*` and `.dev.vars*` are ignored; validation blocks tracked secret files and common credential formats.

Report a vulnerability using `/.well-known/security.txt`. Do not include credentials, full payment data, or unnecessary personal information.

## Rollback

Cloudflare Pages and Workers keep deployment history. If production verification fails, roll the Worker route and Pages project back to their prior known-good deployments, then investigate on a branch. The source archive is provenance only and should not be redeployed directly.
