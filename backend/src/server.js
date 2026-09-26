import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log, logError } from "./lib/logger.js";
import { AtlassianApiError } from "./lib/httpClient.js";
import { openApiSpec } from "./openapi.js";

import configRoutes from "./routes/config.js";
import bitbucketRoutes from "./routes/bitbucket.js";
import jiraRoutes from "./routes/jira.js";
import syncRoutes from "./routes/sync.js";
import aiReviewRoutes from "./routes/aiReview.js";
import prReviewRoutes from "./routes/prReviews.js";
import prReviewPromptRoutes from "./routes/prReviewPrompts.js";
import prExceptionRoutes from "./routes/prExceptions.js";
import adminRoutes from "./routes/admin.js";
import authRoutes from "./routes/auth.js";
import { isMultiTenant } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";

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

app.get("/api/health", (req, res) =>
  res.json({ ok: true, multiTenant: isMultiTenant() })
);

app.get("/api-docs.json", (req, res) => res.json(openApiSpec));
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));

app.use("/api", authRoutes);
app.use("/api", configRoutes);
app.use("/api", bitbucketRoutes);
app.use("/api", jiraRoutes);
app.use("/api", syncRoutes);
app.use("/api", aiReviewRoutes);
app.use("/api", prReviewRoutes);
app.use("/api", prReviewPromptRoutes);
app.use("/api", prExceptionRoutes);
app.use("/api", adminRoutes);

app.use((req, res) => {
  res.status(404).json({ error: { message: "Not found" } });
});

app.use((err, req, res, next) => {
  logError(`${req.method} ${req.originalUrl} failed:`, err.message);

  if (err instanceof AtlassianApiError) {
    return res.status(err.status || 502).json({
      error: { message: err.message, code: err.code, details: err.details },
    });
  }

  res.status(500).json({ error: { message: err.message || "Internal server error" } });
});

async function start() {
  if (isMultiTenant()) {
    if (!process.env.CONFIG_ENCRYPTION_KEY || !/^[0-9a-fA-F]{64}$/.test(process.env.CONFIG_ENCRYPTION_KEY)) {
      logError(
        "CONFIG_ENCRYPTION_KEY must be a 64-char hex string. Generate with: openssl rand -hex 32"
      );
      process.exit(1);
    }
    if (!process.env.JWT_SECRET) {
      log("Warning: JWT_SECRET is unset; using a weak default. Set JWT_SECRET in .env.");
    }
    try {
      await runMigrations();
      log("Multi-tenant mode: PostgreSQL.");
    } catch (err) {
      logError("Failed to init PostgreSQL:", err.message);
      process.exit(1);
    }
  } else {
    log("Single-tenant mode: no DATABASE_URL — using local JSON files (no app login).");
  }

  app.listen(PORT, "0.0.0.0", () => {
    log(`AI Review Performance backend listening on http://localhost:${PORT} (LAN: 0.0.0.0:${PORT})`);
  });
}

start();
