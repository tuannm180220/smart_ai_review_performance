import axios from "axios";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { COMPLEXITY, COMPLETENESS, PR_REVIEW_SIGNALS } from "../lib/prReviewSchema.js";

// In-process mode (used by the HTTP transport mounted on this same Express app)
// calls the route handlers directly via loopback HTTP to `PORT`. Standalone/stdio
// mode (used when this file is spawned as its own process) calls out to
// MCP_BACKEND_URL. Either way, this module holds no Jira/Bitbucket/AI
// credentials of its own — it only ever talks to this backend's own REST API.
function resolveBaseUrl() {
  if (process.env.MCP_BACKEND_URL) return process.env.MCP_BACKEND_URL;
  const port = process.env.PORT || 3001;
  return `http://127.0.0.1:${port}/api`;
}

function textResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err) {
  const message = err.response?.data?.error?.message || err.message;
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

export function createMcpServer() {
  const http = axios.create({ baseURL: resolveBaseUrl(), timeout: 60000 });
  const get = (path, params) => http.get(path, { params }).then((res) => res.data);
  const post = (path, params) => http.post(path, null, { params }).then((res) => res.data);
  const postBody = (path, data) => http.post(path, data).then((res) => res.data);

  const server = new McpServer({ name: "ai-review-performance", version: "1.0.0" });

  server.tool(
    "list_repos",
    "List Bitbucket repositories in the configured workspace.",
    {},
    async () => {
      try {
        return textResult(await get("/bitbucket/repos"));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "list_prs",
    "List pull requests for a repo, optionally filtered by date range, author, or state (OPEN/MERGED/DECLINED).",
    {
      repo: z.string().describe("Repo slug, as returned by list_repos"),
      from: z.string().optional().describe("ISO date, inclusive"),
      to: z.string().optional().describe("ISO date, inclusive"),
      author: z.string().optional(),
      state: z.string().optional(),
    },
    async ({ repo, from, to, author, state }) => {
      try {
        return textResult(await get("/bitbucket/prs", { repo, from, to, author, state }));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_pr_details",
    "Get a pull request's diffstat, commits, review comments, and approval/merge timestamps.",
    { repo: z.string(), id: z.union([z.string(), z.number()]) },
    async ({ repo, id }) => {
      try {
        return textResult(await get(`/bitbucket/prs/${id}/details`, { repo }));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_pr_review_context",
    "Assemble the full evidence bundle for reviewing one PR: metadata, diffstat, commit " +
      "messages, review comments, linked Jira ticket (summary/description/story points/status), " +
      "and the actual unified diff text (lockfiles/binaries/minified files filtered out). This is " +
      "the same context the app would otherwise hand to an AI provider — use it to write the " +
      "review yourself instead of calling the backend's AI Review endpoint.",
    { repo: z.string(), id: z.union([z.string(), z.number()]) },
    async ({ repo, id }) => {
      try {
        return textResult(await get(`/pr-reviews/${repo}/${id}/context`));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "save_pr_review",
    "Publish a PR review you've written (after calling get_pr_review_context) into the shared " +
      "app's store, so it shows up in the web UI's PR Watch table and 'View report' for " +
      "teammates — the same place a review from the web AI Review button would land. Follow the " +
      "same rubric get_pr_review_context implies: cite the diff over metadata, be evidence-based, " +
      "1-3 strengths, 1-4 improvements.",
    {
      repo: z.string(),
      id: z.union([z.string(), z.number()]),
      summary: z.string().describe("1 sentence: what this PR actually delivered vs the ticket"),
      ticketComplexity: z.enum([...COMPLEXITY]),
      codeCompleteness: z.enum([...COMPLETENESS]),
      labelRationale: z.string().describe("1 sentence: evidence for the two labels above"),
      strengths: z.array(z.string()).max(3).describe("Reusable engineering habits, not one-off notes"),
      improvements: z.array(z.string()).max(4).describe("Actionable, cite a file path when possible"),
      signals: z.array(z.enum([...PR_REVIEW_SIGNALS])).optional(),
    },
    async ({ repo, id, ...assessment }) => {
      try {
        return textResult(await postBody(`/pr-reviews/${repo}/${id}/submit`, assessment));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_ticket",
    "Get a Jira ticket's summary, description, story points, full status change history " +
      "(from which reopen count/dates can be derived), and comments. Story points plus " +
      "description/comments are this project's signal for ticket complexity — there is no " +
      "separate 'complexity' field.",
    { key: z.string().describe("Jira issue key, e.g. PROJ-123") },
    async ({ key }) => {
      try {
        return textResult(await get(`/jira/tickets/${encodeURIComponent(key)}`));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "list_records",
    "List locally synced PR<->ticket records (run run_sync first if empty).",
    { repo: z.string().optional() },
    async ({ repo }) => {
      try {
        return textResult(await get("/records", { repo }));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "list_records_by_ticket",
    "Synced records grouped by Jira ticket — one row per ticket with all its PRs, story points, and reopen info.",
    { repo: z.string().optional() },
    async ({ repo }) => {
      try {
        return textResult(await get("/records/by-ticket", { repo }));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "run_sync",
    "Run the PR<->ticket sync pipeline for a repo (fetch PRs, details, linked tickets) and persist the results.",
    {
      repo: z.string(),
      from: z.string().optional(),
      to: z.string().optional(),
      author: z.string().optional(),
      state: z.string().optional(),
    },
    async ({ repo, from, to, author, state }) => {
      try {
        return textResult(await post("/sync", { repo, from, to, author, state }));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  return server;
}
