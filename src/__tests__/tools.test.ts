/**
 * tools.test.ts — unit tests for the MCP tool handler functions.
 *
 * Handlers are tested WITHOUT stdio: deterministic, mocked global fetch
 * (vi.stubGlobal). The stdio wiring in index.ts delegates to these handlers.
 *
 * Surface contract (verified against packages/openapi/openapi.json — D-55):
 *   POST /v1/render?response=url  {template_id|html, data} -> {url}
 *   POST /v1/image?response=url   {template_id|html, data} -> {url}
 *   GET  /v1/templates (public)   -> [{id,name,description,outputType}]
 * Both render bodies are additionalProperties:false — no `output`, no
 * `options`, no `width`/`height` keys may be sent.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listTemplates, renderImage, renderPdf } from '../tools.js';

const CTX = { apiKey: 'binfra_testkey', baseUrl: 'https://api.docjet.dev' };

function mockFetchOnce(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('renderPdf', () => {
  it('POSTs /v1/render?response=url with Bearer key and returns the url', async () => {
    const fn = mockFetchOnce(200, { url: 'https://api.docjet.dev/v1/outputs/abc123?sig=x' });

    const result = await renderPdf(
      { template_id: 'invoice-ro', data: { client: 'Demo SRL', total: 1000 } },
      CTX,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe('https://api.docjet.dev/v1/outputs/abc123?sig=x');

    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('https://api.docjet.dev/v1/render?response=url');
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe('Bearer binfra_testkey');

    // Body must match the live API surface (additionalProperties:false):
    // only template_id|html + data — never `output`, `options`, width/height.
    const body = JSON.parse(init.body);
    expect(body).toEqual({ template_id: 'invoice-ro', data: { client: 'Demo SRL', total: 1000 } });
    expect(body).not.toHaveProperty('output');
    expect(body).not.toHaveProperty('options');
  });

  it('maps a 429 {code:QUOTA_EXCEEDED} response to an MCP error result carrying the code', async () => {
    mockFetchOnce(429, {
      error: 'Monthly render quota exceeded',
      code: 'QUOTA_EXCEEDED',
      hint: 'Upgrade your plan',
    });

    const result = await renderPdf({ html: '<h1>x</h1>' }, CTX);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('QUOTA_EXCEEDED');
  });

  it('rejects when neither template_id nor html is provided', async () => {
    mockFetchOnce(200, { url: 'unreachable' });
    await expect(renderPdf({ data: {} }, CTX)).rejects.toThrow(/template_id.*html|html.*template_id/i);
  });

  it('rejects a template_id that fails SLUG_RE before any network call', async () => {
    const fn = mockFetchOnce(200, { url: 'unreachable' });
    await expect(renderPdf({ template_id: 'Bad_ID!' }, CTX)).rejects.toThrow(/template_id/i);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('renderImage', () => {
  it('POSTs /v1/image?response=url and returns the url', async () => {
    const fn = mockFetchOnce(200, { url: 'https://api.docjet.dev/v1/outputs/png456?sig=y' });

    const result = await renderImage({ template_id: 'og-card', data: { title: 'Hi' } }, CTX);

    expect(result.content[0].text).toBe('https://api.docjet.dev/v1/outputs/png456?sig=y');
    const [url] = fn.mock.calls[0];
    expect(url).toBe('https://api.docjet.dev/v1/image?response=url');
  });
});

describe('listTemplates', () => {
  it('GETs /v1/templates without auth and returns the template array as JSON text', async () => {
    const templates = [
      { id: 'invoice-ro', name: 'Invoice RO', description: 'Romanian invoice', outputType: 'pdf' },
      { id: 'og-card', name: 'OG Card', description: 'Social image', outputType: 'png' },
    ];
    const fn = mockFetchOnce(200, templates);

    const result = await listTemplates({}, CTX);

    expect(JSON.parse(result.content[0].text)).toEqual(templates);

    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('https://api.docjet.dev/v1/templates');
    // Public endpoint — no Authorization header (key never sent where not needed)
    expect(init?.headers?.['Authorization']).toBeUndefined();
  });
});
