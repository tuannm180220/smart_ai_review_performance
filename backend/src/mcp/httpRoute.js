import crypto from "node:crypto";
import { Router } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./tools.js";
import { log, logError } from "../lib/logger.js";

// Mounted at /mcp on the main backend so teammates can point their own Claude
// Code straight at the deployed backend (Streamable HTTP transport) instead of
// each running this project locally. Stateless: no session, no resumability —
// every tool call is just a proxied REST call, so a fresh transport per
// request is enough and avoids holding connection state across requests.

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireAuth(req, res, next) {
  const token = process.env.MCP_AUTH_TOKEN;
  if (!token) return next(); // no token configured — open (e.g. local dev)

  const header = req.get("authorization") || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (provided && timingSafeEqual(provided, token)) return next();

  res.status(401).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: "Unauthorized — missing or invalid bearer token." },
    id: null,
  });
}

const router = Router();

if (!process.env.MCP_AUTH_TOKEN) {
  log("MCP_AUTH_TOKEN is not set — the /mcp endpoint is unauthenticated. Set it before sharing this backend's URL with a team.");
}

router.post("/", requireAuth, async (req, res) => {
  try {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (err) {
    logError("MCP request failed:", err.message);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

function methodNotAllowed(req, res) {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed. This is a stateless MCP endpoint — POST only." },
    id: null,
  });
}

router.get("/", requireAuth, methodNotAllowed);
router.delete("/", requireAuth, methodNotAllowed);

export default router;
