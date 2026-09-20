import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./tools.js";

// Local/standalone entry point: spawned directly by a Claude Code client over
// stdio. Prefer the HTTP route (mounted on the deployed backend at /mcp) for a
// shared setup — this file is for running the backend + MCP server yourself.
const server = createMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
