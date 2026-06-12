# docjet-mcp

MCP server for [DocJet](https://docjet.dev) — render branded PDF documents (invoices, reports, certificates) and PNG social images directly from any MCP client (Claude Desktop, Claude Code, Cursor, Windsurf, ...).

Send a template ID or raw HTML plus JSON data; get back a signed download URL. Runs locally over stdio via `npx` — nothing to host.

## Quick start

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "docjet": {
      "command": "npx",
      "args": ["docjet-mcp"],
      "env": {
        "DOCJET_API_KEY": "binfra_your_key_here"
      }
    }
  }
}
```

Get an API key at [docjet.dev](https://docjet.dev). To try it without signing up, use the public demo key (rate-limited to 3 req/min, 50 renders/month, shared by everyone):

```
binfra_9afb57dbb6478c441ad101129fca65847f5745403f9d718b3de6d934c9b63f88
```

## Tools

| Tool | What it does |
| --- | --- |
| `render_pdf` | Render a branded PDF. Input: `template_id` (or raw `html`) + `data` object. Returns a signed download URL. |
| `render_image` | Render a PNG image (e.g. OG/social card). Input: `template_id` (or raw `html`) + `data` object. Returns a signed download URL. |
| `list_templates` | List available templates: `id`, `name`, `description`, `outputType`. No API key needed. |

Example prompt once connected:

> "List the DocJet templates, then render the invoice-ro template with client 'Demo SRL' and total 1000 as a PDF."

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DOCJET_API_KEY` | Yes | Your DocJet API key (`binfra_` prefix). Sent as a Bearer token; never logged. |
| `DOCJET_BASE_URL` | No | Override the API base URL (default `https://api.docjet.dev`). |

## How it works

- Stdio transport using the official [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) (v1).
- `render_pdf` → `POST /v1/render?response=url`, `render_image` → `POST /v1/image?response=url`, `list_templates` → `GET /v1/templates`.
- Template IDs are validated locally against `^[a-z0-9][a-z0-9-]{0,63}$` before any network call.
- API errors surface as MCP error content with the DocJet error code (e.g. `QUOTA_EXCEEDED`, `RATE_LIMITED`).

## Links

- API docs: [docjet.dev/docs](https://docjet.dev/docs)
- JS/TS SDK: [`docjet` on npm](https://www.npmjs.com/package/docjet)
- Support: support@docjet.dev

## License

MIT
