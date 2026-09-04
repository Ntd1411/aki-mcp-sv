// Factory for the one shared McpServer hosting every in-house tool (shell, agy, kiro, search,
// filesystem) — replaces local-tools-mcp.js's role as a separately spawned stdio child now that
// mcp-hub is gone (docs/plan/done/2.0.0-improve.md #7, Stage 2 phase 2). Each domain's logic stays in
// its own register(server) module behind a stable contract, unchanged from Stage 1.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { register as registerShell } from './shell-mcp.js';
import { register as registerAgy } from './agy-mcp.js';
import { register as registerKiro } from './kiro-mcp.js';
import { register as registerSearch } from './search-mcp.js';
import { register as registerFilesystem } from './filesystem-mcp.js';
import { register as registerPostman } from './postman-mcp.js';

// mcp-hub used to prefix every tool from this server's config entry (key "local") with
// `local__` when aggregating backends. Now that the bridge talks to this server directly, that
// prefixing layer is gone — reproduce it here as the one place doing it, so served tool names
// (local__run_cmd, local__find_path, …) stay exactly what README.md and CLAUDE.md already tell
// every connected AI to call.
function prefixedServer(server, prefix) {
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop !== 'registerTool') return Reflect.get(target, prop, receiver);
      return (name, ...rest) => target.registerTool(`${prefix}${name}`, ...rest);
    },
  });
}

export function createToolsServer() {
  const server = new McpServer({ name: 'local', version: '1.0.0', title: 'Local Tools' });
  const prefixed = prefixedServer(server, 'local__');
  for (const register of [registerShell, registerAgy, registerKiro, registerSearch, registerFilesystem, registerPostman]) register(prefixed);
  return server;
}
