// Entry for runners that import the package directory (e.g. Glama's
// inspector runs the repo under tsx). Real deployments use the Dockerfile
// (HTTP server); this starts the stdio MCP transport instead.
import './src/stdio.ts';
