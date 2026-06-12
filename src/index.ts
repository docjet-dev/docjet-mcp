#!/usr/bin/env node
/**
 * index.ts — docjet-mcp stdio MCP server entry point.
 *
 * Runnable via `npx docjet-mcp`. Exposes three tools over stdio:
 *   render_pdf      — branded PDF via POST /v1/render?response=url
 *   render_image    — PNG via POST /v1/image?response=url
 *   list_templates  — public GET /v1/templates
 *
 * Env:
 *   DOCJET_API_KEY  (required) — Bearer key for render calls
 *   DOCJET_BASE_URL (optional) — defaults to https://api.docjet.dev
 *
 * v1 SDK (@modelcontextprotocol/sdk pinned 1.29.0) import paths — do NOT
 * use the v2 pre-alpha `@modelcontextprotocol/server` package (Pitfall 1).
 *
 * NOTE: stdout is the MCP protocol channel — never console.log here.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { listTemplates, renderImage, renderPdf, SLUG_RE, type ToolCtx } from './tools.js';

const apiKey = process.env.DOCJET_API_KEY;
const baseUrl = (process.env.DOCJET_BASE_URL ?? 'https://api.docjet.dev').replace(/\/$/, '');

if (!apiKey) {
  // stderr only — stdout is reserved for the MCP protocol (T-05-20: never echo keys)
  console.error(
    'docjet-mcp: DOCJET_API_KEY environment variable is required.\n' +
      'Set it in your MCP client config, e.g.\n' +
      '  { "command": "npx", "args": ["docjet-mcp"], "env": { "DOCJET_API_KEY": "binfra_..." } }',
  );
  process.exit(1);
}

const ctx: ToolCtx = { apiKey, baseUrl };

const server = new McpServer({ name: 'docjet', version: '1.0.0' });

// Static tool descriptions — no user/LLM-controllable content (T-05-18)
const renderInputSchema = {
  template_id: z
    .string()
    .regex(SLUG_RE, 'must be a lowercase slug matching ^[a-z0-9][a-z0-9-]{0,63}$')
    .optional()
    .describe('Template ID from list_templates (provide template_id OR html)'),
  html: z
    .string()
    .max(512_000)
    .optional()
    .describe('Raw HTML to render (max 512 KB) — alternative to template_id'),
  data: z
    .record(z.unknown())
    .optional()
    .describe('Template variables (Handlebars data object)'),
};

server.registerTool(
  'render_pdf',
  {
    title: 'Render PDF',
    description:
      'Render a branded PDF document with the DocJet API. Provide a template_id (discover them with list_templates) or raw html, plus a data object for template variables. Returns a signed download URL for the PDF.',
    inputSchema: renderInputSchema,
  },
  async (input) => renderPdf(input, ctx),
);

server.registerTool(
  'render_image',
  {
    title: 'Render Image',
    description:
      'Render a PNG image (e.g. an OG/social card) with the DocJet API. Provide a template_id (discover them with list_templates) or raw html, plus a data object for template variables. Returns a signed download URL for the PNG.',
    inputSchema: renderInputSchema,
  },
  async (input) => renderImage(input, ctx),
);

server.registerTool(
  'list_templates',
  {
    title: 'List Templates',
    description:
      'List the available DocJet templates: id, name, description and outputType (pdf or png). Use a returned id as template_id in render_pdf / render_image.',
    inputSchema: {},
  },
  async () => listTemplates({}, ctx),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error('docjet-mcp: fatal error starting stdio server:', err instanceof Error ? err.message : err);
  process.exit(1);
});
