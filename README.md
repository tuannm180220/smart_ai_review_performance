# AI Review Performance

Pulls Bitbucket pull requests and their linked Jira tickets into one unified
record set, so you can see PR review activity (approvals, merges, comments)
alongside ticket status, story points, and reopen history.

**Live deployment (Render):**
[smart-ai-review-frontend.onrender.com](https://smart-ai-review-frontend.onrender.com)
(backend: [smart-ai-review-backend.onrender.com](https://smart-ai-review-backend.onrender.com)).
Both are free-tier services — the first request after idling can take a few
seconds while it wakes up. Configure Jira/Bitbucket/AI credentials for this
deployment via Render environment variables, not the Settings page — see
**Deploy to Render** below for why.

## Tech stack

- **Frontend**: React (Vite), `http://localhost:5173`
- **Backend**: Node.js + Express, `http://localhost:3001` — proxies all Atlassian
  calls so tokens never touch the browser and CORS never comes up.
- **Storage**: **PostgreSQL** multi-tenant when `DATABASE_URL` is set (per-user
  Settings + synced records). Without it — shared local JSON files (no app login).
- **Auth (multi-tenant)**: App users register/login (`/login`); JWT Bearer on
  `/api/*`. Admin dashboard remains a separate env-based account at `/admin`.
- **Auth (Atlassian)**: Basic Auth (email + API token) against both Jira Cloud REST API v3
  and Bitbucket Cloud REST API v2.0 — separate tokens for each, stored **per app user**
  in Postgres. Bitbucket app
  passwords are deprecated (fully removed July 28, 2026) — use a Bitbucket
  API token instead.

## Setup

```bash
npm run install:all   # installs backend/ and frontend/ deps
npm run dev           # runs both dev servers concurrently
```

Or run them separately:

```bash
cd backend && npm install && npm run dev    # http://localhost:3001
cd frontend && npm install && npm run dev   # http://localhost:5173
```

Open `http://localhost:5173`. With `DATABASE_URL` set, sign in or register
first. Then go to **Settings**, and fill in:

- Atlassian email
- Atlassian API token ([id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)) — for Jira
- Jira base URL (e.g. `https://yourdomain.atlassian.net`)
- Bitbucket API token ([id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)) scoped for
  Bitbucket — a separate token from the Jira one; app passwords no longer work
- Bitbucket workspace — pick from a dropdown populated from the workspaces
  your Bitbucket token can access (click **Refresh** after saving your email
  + Bitbucket API token)
- Jira story points field ID (under **Show advanced**) — varies per Jira
  instance, commonly `customfield_10016`; check **Jira admin → Issues →
  Custom fields** if unsure
- AI agent API key and provider (Claude, Codex, or Cursor) — powers the
  **AI Review** tab; optionally override the model under **Show advanced**

Click **Save settings**, then **Test connection** to confirm Jira and
Bitbucket both come back ✅.

Credentials are written to encrypted columns in PostgreSQL (`user_configs`) when
`DATABASE_URL` is set, or to `backend/data/config.json` in single-tenant mode.
They never leave your machine/backend except in requests to `*.atlassian.net` and
`api.bitbucket.org`. They are never logged (see `backend/src/lib/logger.js`,
which redacts token fields before printing).

## Multi-tenant (PostgreSQL)

Each person has their own Atlassian credentials and synced data in Postgres.

Guide: [`docs/local-multi-tenant.md`](docs/local-multi-tenant.md) · Docker on
port 5433: [`docs/local-postgres.md`](docs/local-postgres.md).

```bash
docker compose up -d
cd backend
npm run migrate
npm run seed-local -- --email you@example.com --password 'your-password'
npm run dev
```

Two browsers → two accounts → Settings/Sync stay separate.

## Deploy to Render

The app deploys as two separate Render services from this repo: a **Web
Service** for the backend and a **Static Site** for the frontend.

### 0. PostgreSQL (multi-tenant — do this first)

1. Render dashboard → **New** → **PostgreSQL**. Same region as the backend
   service, for lower latency. Render's free Postgres **expires after 30
   days** — fine for testing, but use a paid instance for anything you want
   to keep.
2. Copy the **Internal Database URL** (same-region Render services can reach
   each other over Render's private network — faster and doesn't count
   against external connection limits). Use the External URL only if the
   backend lives outside Render.
3. Generate two secrets and keep them somewhere safe (not this repo):
   ```bash
   openssl rand -hex 32     # CONFIG_ENCRYPTION_KEY — must be exactly 64 hex chars
   openssl rand -base64 32  # JWT_SECRET
   ```
4. Set on the **backend** service (Environment tab): `DATABASE_URL` (the
   Internal URL from step 2), `CONFIG_ENCRYPTION_KEY`, `JWT_SECRET`. Optionally
   `ALLOW_REGISTER=false` once your team has all registered, to close
   self-serve sign-up (open by default).
5. Redeploy. The backend applies its schema itself on every boot
   (`runMigrations()` in `backend/src/server.js`, idempotent
   `CREATE TABLE IF NOT EXISTS` — see `backend/src/db/schema.sql`) — no
   separate migration step to run on Render. If `CONFIG_ENCRYPTION_KEY` is
   missing/malformed or Postgres isn't reachable, the service refuses to
   start and logs why (check the Render service's Logs tab).
6. Setting `DATABASE_URL` flips the whole backend into multi-tenant mode —
   every `/api/*` route now requires a logged-in app user (JWT), each with
   their own Jira/Bitbucket/AI credentials in Settings. There's no partial
   state: it's all local-JSON-shared-config or all-Postgres-per-user. Visit
   the frontend, register the first account, then log in and fill in
   Settings as usual.

Have existing data in `backend/data/*.json` from before switching to
Postgres? `npm run import-local` / `npm run seed-local` (see their scripts in
`backend/package.json`) migrate it into an account — run locally against the
same `DATABASE_URL`, not on Render itself.

### 1. Backend — Web Service

- **Root directory**: `backend`
- **Runtime**: Node
- **Build command**: `npm install`
- **Start command**: `npm start`
- **Plan**: Free tier works for trying it out

Render sets `PORT` automatically and the app already binds to
`0.0.0.0:$PORT` (see `backend/src/server.js`), so no changes are needed
there.

Set these environment variables on the service (Render dashboard → your
service → Environment) instead of using the Settings UI, since **the free
tier's disk is ephemeral** — anything the Settings page writes to
`backend/data/config.json`, and any synced records in
`backend/data/records.json`, is wiped on every redeploy or restart:

| Key | Notes |
| --- | --- |
| `DATABASE_URL`, `JWT_SECRET`, `CONFIG_ENCRYPTION_KEY`, `ALLOW_REGISTER` | Multi-tenant Postgres |
| `ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN`, `JIRA_BASE_URL` | Jira (defaults / single-tenant) |
| `BITBUCKET_WORKSPACE`, `BITBUCKET_API_TOKEN` | Bitbucket (separate token — see Setup) |
| `JIRA_STORY_POINTS_FIELD` | Optional, defaults to `customfield_10016` |
| `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` | AI Review tab |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` | Admin dashboard |

If persistent storage matters (so synced PR/ticket data survives restarts),
attach a Render [persistent disk](https://render.com/docs/disks) mounted at
`backend/data` — this requires a paid plan, since the free tier doesn't
support disks.

### 2. Frontend — Static Site

- **Root directory**: `frontend`
- **Build command**: `npm install && npm run build`
- **Publish directory**: `frontend/dist`

Set one environment variable, pointing at the backend service's URL:

| Key | Value |
| --- | --- |
| `VITE_API_BASE_URL` | `https://<your-backend-service>.onrender.com/api` |

`frontend/src/api.js` reads this at build time (Vite inlines `import.meta.env.*`
into the bundle) and falls back to the relative `/api` path used by the dev
proxy when it's unset.

The backend already sends a permissive `cors()` header
(`backend/src/server.js`), so cross-origin requests from the static site's
`onrender.com` domain to the backend's `onrender.com` domain work without
extra configuration.

The app has client-side routes (`/admin/login`, `/admin`) that don't
correspond to real files, so the static site needs a rewrite rule sending
every path to `index.html` and letting React Router take over — otherwise
Render 404s on a direct visit or refresh of those URLs. `frontend/public/_redirects`
(`/*    /index.html   200`) already does this and is copied into `dist/` by
Vite on every build, so no dashboard configuration is needed.

### Notes

- Both services auto-deploy on push to the connected branch.
- Render's free web services spin down after inactivity and take a few
  seconds to wake back up on the next request — expect a cold-start delay
  on the first Sync/AI Review after idling.
- The Claude-subscription auth option (`ant auth login`) in Settings has no
  effect on Render — there's no interactive terminal to run it in, so use a
  real `AI_API_KEY` for the AI Review tab in this deployment.

## Using the app

1. **Explore PRs** — pick a repo and browse pull requests; defaults to the
   last 7 days (widen the range or click **Clear dates** for older PRs).
   Expand a row to see diffstat, commits, review comments, and approval/merge
   timestamps.
2. **Sync & Records** — click **Sync** to run the full pipeline (fetch PRs →
   fetch PR details → extract Jira key from branch/title → fetch ticket →
   persist). Also defaults to the last 7 days — clear the dates to sync
   everything, e.g. for a first-time backfill. The table below reads from
   the local store, not from Atlassian, so reloading the page is instant.
   Filter by author/link-status and sort by any column.
3. **By Ticket** — the same synced data rolled up per Jira ticket, so a
   ticket touched by multiple PRs shows as one row with all its PRs listed.
4. **AI Review** — pick a person and an optional date range. The backend
   assembles an evidence packet per PR (diffstat, commit messages, review
   comment excerpts, linked ticket description/comments) plus the computed
   delivery/quality/rework metrics, and sends it to the configured AI agent
   (Claude, Codex, or Cursor) with instructions to write a structured
   Markdown report — Executive Summary, Delivery, Code Quality, Rework & Bug
   Turnaround, Recommendations, and an Evidence Log citing the specific
   PRs/tickets behind each claim — rather than generic prose. Rendered as a
   formatted document in the UI, with a **Download report (.md)** button to
   save it. Requires a Sync to have run first, and an AI agent configured in
   Settings. Every finished review is saved (report + the selected date range)
   in `member_reviews` (`backend/src/store/memberReviewStore.js`, Postgres or
   `backend/data/member-reviews.json`); picking a person lists their previous
   reviews so any of them can be reopened without calling the AI again.
5. **PR Watch** — the backend polls every 30 minutes for PRs created *today*
   across every repo in the configured workspace. New ones show up in the
   table with a **Not reviewed** badge, a toast, and (once you grant the
   browser permission prompt) a Chrome desktop notification — even while
   you're on a different tab, since tabs stay mounted in the background
   rather than unmounting on switch. Click **Review** to have the AI agent
   write a same-day critique of that one PR — code change assessment, review
   quality (was it rubber-stamped, was turnaround fast, what did comments
   actually say), ticket alignment, and a one-PR performance signal — stored
   against that PR so **View report** can reopen it later. The list is
   scoped to the current UTC calendar day and starts empty again at midnight
   UTC; there's also a **Check for new PRs now** button to poll on demand
   instead of waiting for the next 30-minute tick.

### Edge cases surfaced in the UI

- **No ticket key found** in branch or title → `linkStatus: unlinked`,
  flagged with an orange row tint.
- **Key extracted but the ticket doesn't exist** (404) or isn't visible (403)
  → `linkStatus: ambiguous`, with the raw extracted key still shown.
- **Multiple keys in one branch/title** → the primary key is used, with a
  "multiple" badge and the full candidate list in a tooltip.
- **Ticket reopened after Done/Closed/Resolved** → detected from Jira's
  status changelog; flagged with a reopen-count badge and reopen dates in a
  tooltip.

## API surface (backend)

Interactive docs (Swagger UI) are served by the backend itself at
`/api-docs` — e.g. `https://<your-backend>.onrender.com/api-docs` — with
**Try it out** to actually call an endpoint and see live data, not just read
about it. In multi-tenant mode, click **Authorize** and paste the Bearer
token from `POST /api/auth/login` first. Raw spec: `/api-docs.json`
(`backend/src/openapi.js`).

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/auth/status` | Whether multi-tenant mode is on / register allowed |
| POST | `/api/auth/register` | Create an app user (when `ALLOW_REGISTER` is not `false`) |
| POST | `/api/auth/login` | Login → JWT |
| GET | `/api/auth/me` | Current user |
| GET/POST | `/api/config` | Read/write settings (per user when multi-tenant) |
| POST | `/api/config/test` | Test Jira + Bitbucket auth |
| GET | `/api/config/jira-projects` | List accessible Jira projects |
| GET | `/api/config/bitbucket-workspaces` | List accessible Bitbucket workspaces |
| GET | `/api/bitbucket/repos` | List repos in the configured workspace |
| GET | `/api/bitbucket/prs` | List PRs (`repo`, `from`, `to`, `author`, `state`) |
| GET | `/api/bitbucket/prs/:id/details` | Diffstat, commits, comments, approval/merge timestamps |
| GET | `/api/jira/tickets/:key` | Ticket description, story points, status history, comments |
| POST | `/api/sync` | Run the full PR↔ticket sync pipeline and persist results |
| GET | `/api/records` | Read persisted unified records |
| GET | `/api/records/by-ticket` | Same records grouped by Jira key |
| GET | `/api/ai-review/authors` | Distinct list of PR authors seen in synced records |
| POST | `/api/ai-review` | Run an AI performance review for one person (`author`, `from`, `to`) and save it |
| GET | `/api/ai-review/history` | Past saved member reviews of one person (`author`, `authorUsername`), newest first |
| GET | `/api/ai-review/history/:id` | One saved member review with its full report |
| GET | `/api/pr-watch` | Today's watched PRs (resets at UTC midnight) with review status |
| POST | `/api/pr-watch/refresh` | Poll Bitbucket now instead of waiting for the 30-minute scheduler |
| POST | `/api/pr-watch/:repo/:id/review` | Run an AI critique of one watched PR and persist it |
| GET | `/api/pr-review-prompts` | List repos that have a custom review prompt saved |
| GET | `/api/pr-review-prompts/default` | The built-in default review prompt text |
| GET | `/api/pr-review-prompts/:repo` | Get the review prompt for a repo (custom, or the default) |
| PUT | `/api/pr-review-prompts/:repo` | Create/update a repo's custom review prompt (typed or uploaded `.md`) |
| DELETE | `/api/pr-review-prompts/:repo` | Remove a repo's custom prompt (reverts to the default) |

Every Atlassian call goes through a shared HTTP client
(`backend/src/lib/httpClient.js`) that retries 429/5xx responses with
exponential backoff (honoring `Retry-After` when present), and every route is
wrapped so failures come back as `{ error: { message, code } }` JSON instead
of a crash — the frontend surfaces these as toasts.

All timestamps are stored and transmitted as the ISO 8601 UTC strings
Atlassian returns; the frontend converts to local time only at render time
(`toLocaleString()`), so sorting/filtering stays timezone-consistent.

## Running the unit tests

```bash
cd backend && npm test
```

Covers `extractJiraKey` — the pure function that pulls a `PROJ-123`-style key
out of a branch name or PR title, preferring the branch, normalizing case,
and flagging multiple matches.

## Project layout

```
backend/
  src/
    server.js            Express app; migrates Postgres on boot when DATABASE_URL is set
    db/                  PostgreSQL pool + schema migrations
    lib/                 HTTP client, auth (user + admin), crypto, logger, …
    config/              Config persistence (per-user Postgres or shared file)
    services/            Bitbucket, Jira, sync, AI review
    store/               Record / PR-review / PR-review-prompt / usage stores
    routes/              /api/* route handlers
    tests/               node:test unit tests
  scripts/
    importLocalData.js      Import legacy JSON data into one user
    seedAccountFromLocal.js Seed config.json into Postgres user
docs/
  local-multi-tenant.md
  local-postgres.md
frontend/
  src/
    pages/                 Settings, Explore PRs, Sync & Records, By Ticket, AI Review, PR Watch, Review prompts
    components/            Shared UI (status badges, PR detail panel, Markdown renderer)
    lib/                   Small frontend helpers (e.g. default date-range calc)
    context/                Toast notifications
    api.js                  fetch wrapper for the backend
```

## Review history (a review improves the next one)

Every PR review saved via the AI Review/PR Watch buttons feeds two kinds of
retrospective context into the *next* review's prompt — no extra step to run:

- **Author history** — `getAuthorReviewHistory` in
  `backend/src/services/prReviewService.js` pulls the same author's last 5
  saved reviews (across repos) — signals, labels, and top improvement from
  each — plain SQL/JSON retrieval against `pr_reviews`, no embeddings.
- **Related PRs in the same repo** — `getRelatedRepoReviews` ranks that
  repo's past reviews by text similarity to the current PR (ticket, title,
  files touched) using a small local hashing-trick embedding
  (`backend/src/lib/textEmbedding.js`) — no external embeddings API, vector
  DB, or extra API key; the vector is just another field in the same
  `pr_reviews` JSON. This is the "RAG" half: it surfaces recurring patterns
  in a codebase area even for a first-time contributor there.

Either way, the reviewer can name a recurring pattern ("tests-missing, 3rd
PR running in this area") instead of treating each PR in isolation — while
being told explicitly not to re-score a past PR based on this context.

## Custom review prompts (per repo)

Settings → **Review prompts** lets you override the AI's reviewer
persona/instructions per Bitbucket repo — type your own text or upload a
`.md` file. Saved per user (and per repo) in `pr_review_prompts`
(`backend/src/store/prReviewPromptStore.js`), with the same Postgres/local-
JSON dual storage as the rest of the app. Only the "persona" half of the
system prompt is replaceable (`DEFAULT_REVIEW_PERSONA` in
`backend/src/services/prReviewPrompt.js`) — the factuality rules and the
required JSON output shape always stay enforced, so a custom prompt can't
break parsing of the saved review.

## AI providers (AI Review tab)

Pick one in Settings — all three are called from the backend only, so the
key never touches the browser:

- **Claude** — Anthropic Messages API via `@anthropic-ai/sdk`, default model
  `claude-opus-5`. **Avoids a second purchase:** check "Use my Claude
  Pro/Max subscription instead of an API key" in Settings, after running
  `ant auth login` once on the machine hosting the backend — the SDK then
  authenticates with that OAuth profile (the same one Claude Code uses)
  instead of a metered API key, so usage is billed against the subscription.
  This is subject to the subscription's own usage limits (lower than paid
  API rate limits), so heavy or multi-person use may still need a real key.
- **Codex** — OpenAI Chat Completions API, default model `gpt-5-codex`. No
  equivalent option here — OpenAI's "Sign in with ChatGPT" usage is scoped
  to the Codex CLI/IDE/web surfaces, not exposed as a general API credential,
  so this always needs a separate, separately-billed OpenAI API key.
- **Cursor** — Cursor's Cloud Agents API (`api.cursor.com/v1/agents`), run as
  a no-repo background agent; the backend polls the run until it finishes
  and reads its `result` text. Slower than the other two since it's a full
  agent run rather than a single completion. **No second purchase needed**
  either way — a Cursor API key (Cursor dashboard → API Keys) draws from the
  same monthly usage pool as your existing Cursor plan (Pro includes
  $20/month of usage).

Override the model per provider with the optional "AI model override" field
under Settings → Show advanced.
