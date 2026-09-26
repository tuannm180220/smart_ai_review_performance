// Hand-written OpenAPI 3.0 document for Swagger UI (mounted at /api-docs in
// server.js). Kept as one file rather than JSDoc-per-route so it's easy to
// scan and doesn't drift silently — update it alongside any route change.

const errorSchema = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        message: { type: "string" },
        code: { type: "string" },
      },
    },
  },
};

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "AI Review Performance API",
    version: "1.0.0",
    description:
      "Bitbucket PR + Jira ticket sync, AI-assisted reviews, and usage data. " +
      "In multi-tenant mode (`DATABASE_URL` set) every `/api/*` route below " +
      "except `/auth/register` and `/auth/login` requires a Bearer JWT — log " +
      "in below with **Authorize**, then use **Try it out** to see live data. " +
      "In single-tenant mode (no `DATABASE_URL`) auth is not required.",
  },
  servers: [{ url: "/api" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas: { Error: errorSchema },
  },
  security: [{ bearerAuth: [] }],
  tags: [
    { name: "Auth" },
    { name: "Config" },
    { name: "Bitbucket" },
    { name: "Jira" },
    { name: "Sync & Records" },
    { name: "AI Review" },
    { name: "PR Reviews" },
    { name: "PR Watch" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["Auth"],
        summary: "Health check",
        security: [],
        responses: { 200: { description: "OK" } },
      },
    },
    "/auth/status": {
      get: {
        tags: ["Auth"],
        summary: "Whether this deployment is multi-tenant and open to registration",
        security: [],
        responses: { 200: { description: "OK" } },
      },
    },
    "/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Create an account (multi-tenant only)",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: { email: { type: "string" }, password: { type: "string", minLength: 8 } },
              },
            },
          },
        },
        responses: { 201: { description: "Created — returns a Bearer token" }, 400: { description: "Invalid input" } },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Log in and get a Bearer token",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: { email: { type: "string" }, password: { type: "string" } },
              },
            },
          },
        },
        responses: { 200: { description: "OK — returns a Bearer token" }, 401: { description: "Invalid credentials" } },
      },
    },
    "/auth/me": {
      get: { tags: ["Auth"], summary: "Current logged-in user", responses: { 200: { description: "OK" } } },
    },
    "/config": {
      get: { tags: ["Config"], summary: "Read this user's settings (secrets redacted)", responses: { 200: { description: "OK" } } },
      post: {
        tags: ["Config"],
        summary: "Update this user's Jira/Bitbucket/AI settings",
        requestBody: { content: { "application/json": { schema: { type: "object" } } } },
        responses: { 200: { description: "OK" } },
      },
    },
    "/config/test": {
      post: { tags: ["Config"], summary: "Test Jira + Bitbucket connectivity", responses: { 200: { description: "OK" } } },
    },
    "/config/jira-projects": {
      get: { tags: ["Config"], summary: "List Jira projects visible to the configured token", responses: { 200: { description: "OK" } } },
    },
    "/config/bitbucket-workspaces/{slug}/verify": {
      get: {
        tags: ["Config"],
        summary: "Verify access to a Bitbucket workspace",
        parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "OK" } },
      },
    },
    "/bitbucket/repos": {
      get: { tags: ["Bitbucket"], summary: "List repos in the configured workspace", responses: { 200: { description: "OK" } } },
    },
    "/bitbucket/prs": {
      get: {
        tags: ["Bitbucket"],
        summary: "List pull requests for a repo",
        parameters: [
          { name: "repo", in: "query", required: true, schema: { type: "string" } },
          { name: "from", in: "query", schema: { type: "string", format: "date" } },
          { name: "to", in: "query", schema: { type: "string", format: "date" } },
          { name: "author", in: "query", schema: { type: "string" } },
          { name: "state", in: "query", schema: { type: "string" } },
        ],
        responses: { 200: { description: "OK" }, 400: { description: "Missing repo", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } } },
      },
    },
    "/bitbucket/prs/{id}/details": {
      get: {
        tags: ["Bitbucket"],
        summary: "Diffstat, commits, comments, approval/merge timestamps for one PR",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "repo", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: { 200: { description: "OK" } },
      },
    },
    "/jira/tickets/{key}": {
      get: {
        tags: ["Jira"],
        summary: "Ticket description, story points, status history, comments",
        parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" }, example: "PROJ-123" }],
        responses: { 200: { description: "OK" }, 404: { description: "Not found" } },
      },
    },
    "/sync": {
      post: {
        tags: ["Sync & Records"],
        summary: "Run the PR<->ticket sync pipeline and persist results",
        parameters: [
          { name: "repo", in: "query", required: true, schema: { type: "string" } },
          { name: "from", in: "query", schema: { type: "string", format: "date" } },
          { name: "to", in: "query", schema: { type: "string", format: "date" } },
          { name: "author", in: "query", schema: { type: "string" } },
          { name: "state", in: "query", schema: { type: "string" } },
        ],
        responses: { 200: { description: "OK" } },
      },
    },
    "/records": {
      get: {
        tags: ["Sync & Records"],
        summary: "Persisted unified PR+ticket records",
        parameters: [{ name: "repo", in: "query", schema: { type: "string" } }],
        responses: { 200: { description: "OK" } },
      },
    },
    "/records/by-ticket": {
      get: {
        tags: ["Sync & Records"],
        summary: "Same records grouped by Jira ticket",
        parameters: [{ name: "repo", in: "query", schema: { type: "string" } }],
        responses: { 200: { description: "OK" } },
      },
    },
    "/ai-review/authors": {
      get: { tags: ["AI Review"], summary: "Distinct PR authors seen in synced records", responses: { 200: { description: "OK" } } },
    },
    "/ai-review": {
      post: {
        tags: ["AI Review"],
        summary: "Run an AI performance review for one person",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  author: { type: "string" },
                  authorUsername: { type: "string" },
                  from: { type: "string", format: "date" },
                  to: { type: "string", format: "date" },
                  mode: { type: "string" },
                },
              },
            },
          },
        },
        responses: { 200: { description: "OK — the saved member review (includes id, reviewedAt)" } },
      },
    },
    "/ai-review/history": {
      get: {
        tags: ["AI Review"],
        summary: "Past member reviews of one person, newest first (summary, no report body)",
        parameters: [
          { name: "author", in: "query", schema: { type: "string" } },
          { name: "authorUsername", in: "query", schema: { type: "string" } },
        ],
        responses: { 200: { description: "OK" } },
      },
    },
    "/ai-review/history/{id}": {
      get: {
        tags: ["AI Review"],
        summary: "One saved member review with its full report",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "OK" }, 404: { description: "Not found" } },
      },
    },
    "/pr-reviews": {
      get: {
        tags: ["PR Reviews"],
        summary: "List saved PR reviews",
        parameters: [
          { name: "author", in: "query", schema: { type: "string" } },
          { name: "from", in: "query", schema: { type: "string", format: "date" } },
          { name: "to", in: "query", schema: { type: "string", format: "date" } },
          { name: "repo", in: "query", schema: { type: "string" } },
        ],
        responses: { 200: { description: "OK" } },
      },
    },
    "/pr-reviews/status": {
      get: {
        tags: ["PR Reviews"],
        summary: "Reviewed-status map for a repo (light payload for table badges)",
        parameters: [{ name: "repo", in: "query", schema: { type: "string" } }],
        responses: { 200: { description: "OK" } },
      },
    },
    "/pr-reviews/{repo}/{id}": {
      get: {
        tags: ["PR Reviews"],
        summary: "Get the saved review for one PR",
        parameters: [
          { name: "repo", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { 200: { description: "OK" }, 404: { description: "No saved review" } },
      },
      post: {
        tags: ["PR Reviews"],
        summary: "Run an AI review of one PR (evidence + diff + author history -> AI provider) and save it",
        parameters: [
          { name: "repo", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { 200: { description: "OK" } },
      },
    },
    "/pr-review-prompts": {
      get: {
        tags: ["PR Review Prompts"],
        summary: "List this user's custom review skills (one row per repo + skill kind)",
        responses: { 200: { description: "OK" } },
      },
    },
    "/pr-review-prompts/skills": {
      get: {
        tags: ["PR Review Prompts"],
        summary: "List review skills (base + type skills) with when they apply and their default text",
        responses: { 200: { description: "OK" } },
      },
    },
    "/pr-review-prompts/default": {
      get: {
        tags: ["PR Review Prompts"],
        summary: "Get the built-in default text of one review skill",
        parameters: [{ name: "kind", in: "query", required: false, schema: { type: "string", enum: ["base", "feature", "export", "bugfix", "data"], default: "base" } }],
        responses: { 200: { description: "OK" } },
      },
    },
    "/pr-review-prompts/{repo}": {
      get: {
        tags: ["PR Review Prompts"],
        summary: "Get the review prompt for a repo (custom override, or the default if none set)",
        parameters: [{ name: "repo", in: "path", required: true, schema: { type: "string" } }, { name: "kind", in: "query", required: false, schema: { type: "string", enum: ["base", "feature", "export", "bugfix", "data"], default: "base" } }],
        responses: { 200: { description: "OK" } },
      },
      put: {
        tags: ["PR Review Prompts"],
        summary: "Create or update a repo's custom review skill (typed or uploaded .md text)",
        parameters: [{ name: "repo", in: "path", required: true, schema: { type: "string" } }, { name: "kind", in: "query", required: false, schema: { type: "string", enum: ["base", "feature", "export", "bugfix", "data"], default: "base" } }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["promptText"],
                properties: {
                  promptText: { type: "string" },
                  source: { type: "string", enum: ["typed", "uploaded"] },
                  filename: { type: "string" },
                },
              },
            },
          },
        },
        responses: { 200: { description: "OK" }, 400: { description: "Invalid promptText" } },
      },
      delete: {
        tags: ["PR Review Prompts"],
        summary: "Remove a repo's custom review skill (reverts to the built-in default)",
        parameters: [{ name: "repo", in: "path", required: true, schema: { type: "string" } }, { name: "kind", in: "query", required: false, schema: { type: "string", enum: ["base", "feature", "export", "bugfix", "data"], default: "base" } }],
        responses: { 200: { description: "OK" } },
      },
    },
    "/pr-watch": {
      get: { tags: ["PR Watch"], summary: "Today's watched PRs with review status", responses: { 200: { description: "OK" } } },
    },
    "/pr-watch/refresh": {
      post: { tags: ["PR Watch"], summary: "Poll Bitbucket now for new PRs", responses: { 200: { description: "OK" } } },
    },
    "/pr-watch/{repo}/{id}/review": {
      post: {
        tags: ["PR Watch"],
        summary: "Run a same-day AI critique of one watched PR",
        parameters: [
          { name: "repo", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { 200: { description: "OK" }, 404: { description: "Not in today's watch list" } },
      },
    },
  },
};
