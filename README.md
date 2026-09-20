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
- **Storage**: SQLite via `better-sqlite3` when it installs cleanly on your
  platform, otherwise a JSON file (`backend/data/records.json`) — the app
  picks automatically at boot and logs which one it's using.
- **Auth**: Basic Auth (email + API token) against both Jira Cloud REST API v3
  and Bitbucket Cloud REST API v2.0 — separate tokens for each. Bitbucket app
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

Open `http://localhost:5173`, go to **Settings**, and fill in:

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

Credentials are written to `backend/data/config.json`, which is gitignored
and never leaves your machine except in requests to `*.atlassian.net` and
`api.bitbucket.org`. They are never logged (see `backend/src/lib/logger.js`,
which redacts token fields before printing).

## Deploy to Render

The app deploys as two separate Render services from this repo: a **Web
Service** for the backend and a **Static Site** for the frontend.

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
| `ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN`, `JIRA_BASE_URL` | Jira |
| `BITBUCKET_WORKSPACE`, `BITBUCKET_API_TOKEN` | Bitbucket (separate token — see Setup) |
| `JIRA_STORY_POINTS_FIELD` | Optional, defaults to `customfield_10016` |
| `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` | AI Review tab |

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
   Settings.
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

| Method | Path | Purpose |
| --- | --- | --- |
| GET/POST | `/api/config` | Read/write local settings |
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
| POST | `/api/ai-review` | Run an AI performance review for one person (`author`, `from`, `to`) |
| GET | `/api/pr-watch` | Today's watched PRs (resets at UTC midnight) with review status |
| POST | `/api/pr-watch/refresh` | Poll Bitbucket now instead of waiting for the 30-minute scheduler |
| POST | `/api/pr-watch/:repo/:id/review` | Run an AI critique of one watched PR and persist it |

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
    server.js            Express app + error handling, starts the PR-watch scheduler
    lib/                 HTTP client w/ retry, ADF renderer, key extractor, logger, PR-watch scheduler
    config/               Local config persistence
    services/             Bitbucket, Jira, sync-orchestration, and AI provider/review logic
    store/                SQLite/JSON record storage abstraction, daily PR-watch storage
    routes/                /api/* route handlers
    tests/                 node:test unit tests
frontend/
  src/
    pages/                 Settings, Explore PRs, Sync & Records, By Ticket, AI Review, PR Watch
    components/            Shared UI (status badges, PR detail panel, Markdown renderer)
    lib/                   Small frontend helpers (e.g. default date-range calc)
    context/                Toast notifications
    api.js                  fetch wrapper for the backend
```

## MCP server (review PRs from your own Claude Code, no AI_API_KEY)

This project's data — PRs, diffs, linked Jira tickets, synced records — is
exposed as MCP tools, so anyone can review pull requests and gauge ticket
complexity directly from their own Claude Code in VS Code, using their own
Claude subscription/login instead of the `AI_API_KEY` the web **AI Review**
tab needs. The MCP server only talks to *this backend's* REST API — it holds
no Jira/Bitbucket/AI credentials of its own, and reuses whatever the backend
is already configured with.

Tools exposed: `list_repos`, `list_prs`, `get_pr_details`,
`get_pr_review_context` (full evidence bundle + diff, the same context the
web tab would otherwise send to an AI provider), `get_ticket` (description,
story points, status history/reopens — this project's complexity signal),
`list_records`, `list_records_by_ticket`, `run_sync`.

### Shared setup (recommended — teammates run nothing locally)

The backend serves the MCP endpoint itself at `POST /mcp` (Streamable HTTP,
`backend/src/mcp/httpRoute.js`), right alongside the existing REST API — so
once it's deployed (e.g. the Render backend in **Deploy to Render** below),
every teammate just points their own Claude Code at that URL. No one clones
the repo, installs Node, or runs `npm run dev` to use it.

1. On the shared backend's host, set `MCP_AUTH_TOKEN` to a random shared
   secret (env var, same place as `AI_API_KEY` etc.) and redeploy. Anyone who
   has this token can call every tool below (read PR/ticket data, trigger a
   sync), so hand it out over a private channel (password manager, DM), not
   in this repo.
2. This repo's root `.mcp.json` already registers the server:
   ```json
   {
     "mcpServers": {
       "ai-review-performance": {
         "type": "http",
         "url": "https://smart-ai-review-backend.onrender.com/mcp",
         "headers": { "Authorization": "Bearer ${MCP_AUTH_TOKEN}" }
       }
     }
   }
   ```
   Update the `url` if your team's backend lives elsewhere.
3. Each teammate sets `MCP_AUTH_TOKEN` in their own shell/OS environment
   (never committed) and opens this repo in VS Code. Claude Code prompts to
   approve the project's MCP server the first time — approve it.
4. Ask Claude Code things like *"review PR 42 in repo my-service"* or *"how
   complex is ticket PROJ-123?"* — it calls `get_pr_review_context` /
   `get_ticket` to pull real diffs, commits, comments, and ticket data, then
   writes the review itself, on that person's own Claude Code login.

### Local/solo alternative

Prefer running everything yourself instead of a shared backend? Swap the
`.mcp.json` entry for a locally-spawned stdio server instead of the remote
URL:

```json
{
  "mcpServers": {
    "ai-review-performance": {
      "command": "node",
      "args": ["backend/src/mcp/server.js"]
    }
  }
}
```

This talks to `http://localhost:3001/api` by default (override with
`MCP_BACKEND_URL`), so it needs your own `cd backend && npm run dev` running.

Either way, this is the recommended path for teammates instead of
configuring `AI_API_KEY`/`AI_USE_CLAUDE_SUBSCRIPTION` for the web AI Review
tab — each person's own Claude Code does the review on their own login, with
no shared key or subscription contention.

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
