import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
const server = new McpServer({ name: 'slim-stdio-fixture', version: '1.0.0' });
server.registerTool(
  'echo',
  { description: 'Echo synthetic input', inputSchema: { text: z.string() } },
  async ({ text }) => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify({ text, inheritedSecret: !!process.env.A0_SLIM_TEST_SECRET }),
      },
    ],
  }),
);
await server.connect(new StdioServerTransport());
