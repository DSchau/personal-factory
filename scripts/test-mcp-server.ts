/**
 * A small MCP server for trying Factory's `tools` option locally.
 *
 *   pnpm mcp:test            # http://127.0.0.1:4120/mcp, token "factory-test-token"
 *
 * Then set in .env and restart `pnpm dev`:
 *   FACTORY_MCP_URL=http://127.0.0.1:4120/mcp
 *   FACTORY_MCP_TOKEN=factory-test-token
 *
 * Every request must carry `Authorization: Bearer <token>`, like a hosted MCP
 * server would require, so the Factory side has to send its credential.
 */
import { createServer } from 'node:http';
import { createTool } from '@mastra/core/tools';
import { MCPServer } from '@mastra/mcp';
import { z } from 'zod';

const port = Number(process.env.FACTORY_TEST_MCP_PORT ?? 4120);
const token = process.env.FACTORY_TEST_MCP_TOKEN ?? 'factory-test-token';

const tickets = new Map([
  ['T-1', { id: 'T-1', title: 'Checkout page times out', status: 'open', assignee: 'dustin' }],
  ['T-2', { id: 'T-2', title: 'Add dark mode to settings', status: 'in_progress', assignee: 'joel' }],
  ['T-3', { id: 'T-3', title: 'Slack Stop button missing', status: 'done', assignee: 'daniel' }],
]);

const server = new MCPServer({
  name: 'Factory test tickets',
  version: '1.0.0',
  tools: {
    list_tickets: createTool({
      id: 'list_tickets',
      description: 'List tickets in the test tracker, optionally filtered by status.',
      inputSchema: z.object({ status: z.enum(['open', 'in_progress', 'done']).optional() }),
      execute: async ({ status }) => ({
        tickets: [...tickets.values()].filter(ticket => !status || ticket.status === status),
      }),
    }),
    get_ticket: createTool({
      id: 'get_ticket',
      description: 'Get one ticket from the test tracker by id, e.g. T-1.',
      inputSchema: z.object({ id: z.string().regex(/^T-\d+$/) }),
      execute: async ({ id }) => tickets.get(id) ?? { error: `No ticket ${id}` },
    }),
  },
});

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (req.headers.authorization !== `Bearer ${token}`) {
    console.log(`[test-mcp] 401 ${req.method} ${url.pathname}`);
    res.writeHead(401).end();
    return;
  }
  console.log(`[test-mcp] ${req.method} ${url.pathname}`);
  await server.startHTTP({ url, httpPath: '/mcp', req, res });
}).listen(port, '127.0.0.1', () => {
  console.log(`[test-mcp] listening on http://127.0.0.1:${port}/mcp (bearer ${token})`);
});
