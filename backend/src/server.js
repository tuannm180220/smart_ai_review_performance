import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log, logError } from "./lib/logger.js";
import { AtlassianApiError } from "./lib/httpClient.js";

import configRoutes from "./routes/config.js";
import bitbucketRoutes from "./routes/bitbucket.js";
import jiraRoutes from "./routes/jira.js";
import syncRoutes from "./routes/sync.js";
import aiReviewRoutes from "./routes/aiReview.js";
import prReviewRoutes from "./routes/prReviews.js";
import adminRoutes from "./routes/admin.js";
import mcpRoute from "./mcp/httpRoute.js";

// Load backend/.env if present, without adding a dependency.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api", configRoutes);
app.use("/api", bitbucketRoutes);
app.use("/api", jiraRoutes);
app.use("/api", syncRoutes);
app.use("/api", aiReviewRoutes);
app.use("/api", prReviewRoutes);
app.use("/api", adminRoutes);
app.use("/mcp", mcpRoute);

app.use((req, res) => {
  res.status(404).json({ error: { message: "Not found" } });
});

// Central error handler: never let a raw stack trace or crash reach the client.
app.use((err, req, res, next) => {
  logError(`${req.method} ${req.originalUrl} failed:`, err.message);

  if (err instanceof AtlassianApiError) {
    return res.status(err.status || 502).json({
      error: { message: err.message, code: err.code, details: err.details },
    });
  }

  res.status(500).json({ error: { message: err.message || "Internal server error" } });
});

app.listen(PORT, "0.0.0.0", () => {
  log(`AI Review Performance backend listening on http://localhost:${PORT} (LAN: 0.0.0.0:${PORT})`);
});

