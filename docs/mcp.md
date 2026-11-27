# MCP — connect your own LLM (free, read-only)

OficinaOS ships a local [MCP](https://modelcontextprotocol.io) server that lets
you connect your own LLM — Claude Desktop, Cursor, LM Studio or any MCP
client — to your shop's data. **Read-only, free, no Cloud required.**

- **Read-only.** The assistant can consult repairs, customers, inventory,
  sales, quotes, suppliers, time entries and statistics. There are no write
  tools — any write attempt answers "Escrita só no OficinaOS Pro".
- **Local only.** The HTTP transport listens exclusively on `127.0.0.1`
  (loopback) — never on the shop network. The stdio transport talks directly
  to the database on the same machine.
- **Personal tokens.** Tokens (`oos_*`) are created in
  **Profile → Security → Connect your LLM**, stored as a SHA-256 hash and shown
  only once. They inherit the user's permissions — a technician can't read
  what the app doesn't show them. Each token can expire and can be revoked.
- **GDPR by default.** Phone, email and tax ID are masked unless you
  explicitly opt in per token — the UI shows a GDPR warning, because that
  data is then sent to the LLM provider you chose.
- **Never exposed:** password hashes, PINs, device unlock codes/patterns,
  tokens/keys (including integrations) and signature images.
- Every call is audit-logged (token, tool, timestamp, record count) and
  rate-limited to 60 calls/minute per token.

## Quick start

1. In the app, open **Profile → Security → Connect your LLM** and create a token.
   Copy it — it is shown only once.
2. Copy the ready-made configuration for your client (the UI offers Claude
   Desktop, Cursor and LM Studio) and replace `<TOKEN>` with your token.
3. Restart the client. Ask something like "which repairs are waiting for
   parts?"

## Transports

### stdio — `bunx oficinaos-mcp` (token no ambiente)

The recommended transport for desktop clients. It reads `DATABASE_URL` from
the environment or the `.env` in the working directory and uses the exact
same core as the HTTP server (permissions, masking, rate limit, audit).

> **Prefer `MCP_TOKEN` in the environment over `--token` in argv.** Flags in
> the command line are visible to every local user in `ps`/`top` while the
> client runs; environment variables are not. `--token` still works for
> compatibility, but use it only when the client can't set env vars.

Native install (Windows service / Linux):

```json
{
  "mcpServers": {
    "oficinaos": {
      "command": "bunx",
      "args": ["oficinaos-mcp"],
      "env": { "MCP_TOKEN": "oos_<your-token>" }
    }
  }
}
```

Docker install — the app runs inside the container, so the client executes
the binary through `docker compose exec` (adjust the compose file path):

```json
{
  "mcpServers": {
    "oficinaos": {
      "command": "docker",
      "args": [
        "compose", "-f", "/path/to/docker-compose.yml",
        "exec", "-T", "-e", "MCP_TOKEN=oos_<your-token>",
        "app", "bunx", "oficinaos-mcp"
      ]
    }
  }
}
```

### HTTP — `http://127.0.0.1:4100/mcp`

Streamable HTTP, bound to loopback only. Useful for clients that prefer a
URL (e.g. LM Studio). Authenticate with `Authorization: Bearer oos_<token>`.
The port can be changed with `MCP_PORT`; `MCP_DISABLED=true` turns the
listener off.

## Tool reference

| Area | Tools | Permission needed |
| --- | --- | --- |
| Repairs | `search_jobs`, `get_job`, `list_jobs_by_status` | jobs:view |
| Customers | `search_customers`, `get_customer` | customers:view |
| Inventory | `search_inventory`, `low_stock` | parts:viewCatalog |
| Sales & cash | `search_sales`, `get_sale`, `cash_summary` | sales:view / reports:viewShop |
| Quotes | `list_quotes` | jobs:view |
| Suppliers & RMAs | `search_suppliers`, `list_supplier_rmas` | parts:viewCatalog |
| Reference catalogues | `search_repairs`, `search_device_models` | repairs:viewCatalog / jobs:view |
| Time tracking | `list_time_entries` | reports:viewShop |
| Statistics | `daily_summary` | reports:viewSelf |

All list tools paginate with `page`/`pageSize` (max 50 per call) and return
`total`. Data is always wrapped in `<oficinaos_dados>…</oficinaos_dados>`
markers with an explicit note that the content is data, never instructions
(prompt-injection containment).

## Security notes

- The HTTP listener binds **only** `127.0.0.1`. There is no configuration
  that exposes it to the LAN — by design, because the shop app itself runs
  on plain LAN HTTP.
- Tokens are personal: they act with the creating user's role permissions,
  evaluated at call time. If a user's role is reduced, their tokens lose
  access immediately.
- Revoking a token takes effect on the next call (`401`).
- Rate limit: 60 calls/minute per token (`429` beyond that).
