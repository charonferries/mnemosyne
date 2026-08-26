import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './mcp.js';

/**
 * Stdio entry point. The hosted instance speaks streamable HTTP (/mcp), but
 * launcher-style runners — Glama's inspector, `claude mcp add` without
 * --transport, anything wrapping a child process — expect a server on
 * stdio. Same tools, one anonymous server per process: reads work as-is,
 * write tools take their bearer token via the `token` argument (there is no
 * Authorization header on a pipe).
 *
 * stdout is the JSON-RPC channel — anything human goes to stderr.
 */
const server = buildServer(null, 'stdio');
await server.connect(new StdioServerTransport());
console.error('mnemosyne: MCP server on stdio (anonymous; write tools accept a `token` argument)');
