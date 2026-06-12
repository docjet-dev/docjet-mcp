/**
 * tools.ts — DocJet MCP tool handler functions.
 *
 * Pure handler functions taking (input, ctx) so they are testable WITHOUT
 * stdio (deterministic with mocked fetch). index.ts wires them into the
 * McpServer over StdioServerTransport.
 *
 * Surface contract (verified against packages/openapi/openapi.json — D-55):
 *   POST /v1/render?response=url  (Bearer) {template_id|html, data} -> {url}
 *   POST /v1/image?response=url   (Bearer) {template_id|html, data} -> {url}
 *   GET  /v1/templates            (public) -> [{id,name,description,outputType}]
 *
 * Both render bodies are additionalProperties:false on the server — the body
 * sent here contains ONLY template_id|html + data (no output/options keys).
 *
 * Security (threat model):
 *   T-05-19 — template_id validated against SLUG_RE before any request
 *   T-05-20 — apiKey sent only in the Authorization header, never logged,
 *             never included in error content (errors surface taxonomy codes)
 */

/** Template ID allowlist — same SLUG_RE enforced server-side (registry.ts). */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface ToolCtx {
  /** DocJet API key (binfra_ prefix) — from DOCJET_API_KEY env. */
  apiKey: string;
  /** API base URL without trailing slash — from DOCJET_BASE_URL env. */
  baseUrl: string;
}

export interface RenderInput {
  /** Template ID from list_templates (use template_id OR html). */
  template_id?: string;
  /** Raw HTML to render — alternative to template_id. */
  html?: string;
  /** Template variables (Handlebars data). */
  data?: Record<string, unknown> | null;
}

/** MCP CallToolResult-shaped return: text content, optional isError flag. */
export interface ToolResult {
  // Index signature required for assignability to the SDK's CallToolResult
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** Error taxonomy body shape returned by the API on non-2xx. */
interface ApiErrorBody {
  error?: string;
  code?: string;
  hint?: string;
}

function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

/** Map a non-2xx API response to an MCP error result carrying the taxonomy code. */
async function errorResult(res: { status: number; json: () => Promise<unknown> }): Promise<ToolResult> {
  let code = 'INTERNAL_ERROR';
  let message = `DocJet API error: HTTP ${res.status}`;
  let hint = '';
  try {
    const body = (await res.json()) as ApiErrorBody;
    if (body.code) code = body.code;
    if (body.error) message = body.error;
    if (body.hint) hint = ` (hint: ${body.hint})`;
  } catch {
    // non-JSON error body — keep defaults
  }
  return {
    isError: true,
    content: [{ type: 'text', text: `${code}: ${message}${hint} [HTTP ${res.status}]` }],
  };
}

/** Validate render input: template_id-or-html required; slug allowlist. */
function validateRenderInput(input: RenderInput): void {
  if (input.template_id === undefined && input.html === undefined) {
    throw new Error('Either template_id or html must be provided');
  }
  if (input.template_id !== undefined && !SLUG_RE.test(input.template_id)) {
    throw new Error(
      `Invalid template_id: must match ^[a-z0-9][a-z0-9-]{0,63}$ (lowercase slug)`,
    );
  }
}

/** Build the request body exactly per the openapi surface (no extra keys). */
function buildRenderBody(input: RenderInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.template_id !== undefined) body.template_id = input.template_id;
  if (input.html !== undefined) body.html = input.html;
  if (input.data !== undefined) body.data = input.data;
  return body;
}

/**
 * Shared request helper: fetch + error-taxonomy mapping.
 * Returns `{ json }` on 2xx, or `{ error }` (an MCP error result) on non-2xx.
 */
async function request(
  method: 'GET' | 'POST',
  path: string,
  ctx: ToolCtx,
  opts: { body?: unknown; auth?: boolean } = {},
): Promise<{ json: unknown } | { error: ToolResult }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.auth) {
    headers['Authorization'] = `Bearer ${ctx.apiKey}`;
  }
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${ctx.baseUrl}${path}`, init);
  if (!res.ok) {
    return { error: await errorResult(res) };
  }
  return { json: await res.json() };
}

/** Shared render flow for both output endpoints (?response=url → {url}). */
async function renderToUrl(endpoint: string, input: RenderInput, ctx: ToolCtx): Promise<ToolResult> {
  validateRenderInput(input);
  const r = await request('POST', `${endpoint}?response=url`, ctx, {
    body: buildRenderBody(input),
    auth: true,
  });
  if ('error' in r) return r.error;
  const data = r.json as { url?: string };
  return textResult(data.url ?? JSON.stringify(data));
}

/**
 * render_pdf — POST /v1/render?response=url, returns the signed PDF URL.
 */
export async function renderPdf(input: RenderInput, ctx: ToolCtx): Promise<ToolResult> {
  return renderToUrl('/v1/render', input, ctx);
}

/**
 * render_image — POST /v1/image?response=url, returns the signed PNG URL.
 */
export async function renderImage(input: RenderInput, ctx: ToolCtx): Promise<ToolResult> {
  return renderToUrl('/v1/image', input, ctx);
}

/**
 * list_templates — GET /v1/templates (public, no auth), returns the array
 * as pretty-printed JSON text content.
 */
export async function listTemplates(_input: Record<string, never>, ctx: ToolCtx): Promise<ToolResult> {
  const r = await request('GET', '/v1/templates', ctx, { auth: false });
  if ('error' in r) return r.error;
  return textResult(JSON.stringify(r.json, null, 2));
}
