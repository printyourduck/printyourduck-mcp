# PrintYourDuck MCP

[![CI](https://github.com/printyourduck/printyourduck-mcp/actions/workflows/checks.yml/badge.svg)](https://github.com/printyourduck/printyourduck-mcp/actions/workflows/checks.yml)
[![Security](https://github.com/printyourduck/printyourduck-mcp/actions/workflows/security.yml/badge.svg)](https://github.com/printyourduck/printyourduck-mcp/actions/workflows/security.yml)
[![MCP](https://img.shields.io/badge/MCP-com.printyourduck%2Fquote-blue)](https://printyourduck.com/server.json)
[![Node.js >=20](https://img.shields.io/badge/node-%3E%3D20-339933)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

MCP server for sending local 3D print files to PrintYourDuck manual quote
review. It is built for coding-agent workflows where the user has generated or
selected a local `.stl`, `.step`, `.stp`, `.3mf`, `.obj`, or `.zip` file and
wants help preparing a quote request.

The server is preconfigured for `https://printyourduck.com`. Users do not need
to supply an API URL, API key, or shop routing configuration.

<!-- mcp-name: com.printyourduck/quote -->

## Status

| Surface | Status |
| --- | --- |
| Remote MCP | Live at `https://printyourduck.com/api/mcp` |
| Local stdio package | Available via npm as `@printyourduck/mcp` |
| npm package | Public: `@printyourduck/mcp` |
| OCI image | Release target: `ghcr.io/printyourduck/printyourduck-mcp:<version>` |
| MCP Registry | Live as `com.printyourduck/quote` |

`npx` is the primary install path today. Use Docker only after verifying the
GHCR image is publicly pullable for the target version.

## Why This Exists

3D-print quote workflows are easy to get wrong when a user is coming from code,
CAD generation, or rapid prototyping. This MCP server gives agents a narrow,
auditable workflow:

1. Read the public quote requirements.
2. Find recent printable files in the current project.
3. Ask the user to choose one file and confirm the required safety statements.
4. Upload that file through PrintYourDuck's private upload flow.
5. Submit the manual quote request.
6. Check public-safe quote status by quote ID and customer email.

It does not calculate instant pricing, collect payment at upload, automate
checkout, or expose private operational details.

## Install

Use this now:

```bash
npx -y @printyourduck/mcp
```

For team-shared or reproducible client configs, pin a package version:

```bash
npx -y @printyourduck/mcp@<version>
```

## Client Setup

MCP client configuration files are not identical across clients. Use the shape
expected by your client, then restart or refresh that client so it reloads the
server.

Claude Code, local user setup:

```bash
claude mcp add --transport stdio printyourduck -- npx -y @printyourduck/mcp
```

Claude Code, project-shared `.mcp.json`:

```json
{
  "mcpServers": {
    "printyourduck": {
      "command": "npx",
      "args": ["-y", "@printyourduck/mcp"]
    }
  }
}
```

Use project-shared `.mcp.json` only when a repository should intentionally
offer PrintYourDuck tools to everyone opening that project. Claude Code prompts
for approval before using project-scoped MCP servers.

VS Code workspace setup in `.vscode/mcp.json`:

```json
{
  "servers": {
    "printyourduck": {
      "command": "npx",
      "args": ["-y", "@printyourduck/mcp"]
    }
  }
}
```

Clients that use the common `mcpServers` shape can use the Claude Code project
snippet above.

Test the local server with MCP Inspector:

```bash
npx -y @modelcontextprotocol/inspector npx -y @printyourduck/mcp
```

Docker, after verifying the GHCR image is public:

```bash
docker run --rm -i ghcr.io/printyourduck/printyourduck-mcp:<version>
```

Remote-capable MCP clients can connect today:

```text
https://printyourduck.com/api/mcp
```

Claude Code remote HTTP setup:

```bash
claude mcp add --transport http printyourduck https://printyourduck.com/api/mcp
```

## Tools

| Tool | Purpose | Network/File Access |
| --- | --- | --- |
| `get_printyourduck_quote_requirements` | Returns accepted file types, material choices, required confirmations, and safety boundaries. | No local file access. No network. |
| `find_recent_printable_files` | Finds recent printable files under an allowed local project directory. | Read-only local file metadata. |
| `submit_local_file_for_quote` | Uploads one user-approved local file and creates a manual quote request. | Reads one allowed local file, uploads privately, then submits to PrintYourDuck. |
| `get_quote_status` | Looks up public-safe quote status with quote ID and matching email. | Network request to PrintYourDuck only. |

Local file discovery and upload are limited to the current working directory by
default. Set `PRINTYOURDUCK_MCP_ALLOWED_ROOTS` to a path-delimited allowlist when
the MCP client should access additional project directories.

`submit_local_file_for_quote` derives a stable `submissionId` from the selected
file and quote details unless the caller provides one. Reuse that ID on retry to
avoid duplicate manual quote requests. The helper also caches the uploaded
private file key locally by `submissionId` and file hash so retries can reuse the
same uploaded file reference when the upload service returns a generated Blob
key.

## Guardrails

This server preserves the PrintYourDuck manual-quote boundary:

- no instant pricing today;
- no payment at upload;
- no checkout automation;
- no local-production, Canadian-made-production, or guaranteed-delivery claims;
- no supplier locations, fulfilment routes, carrier strategy, supplier costs,
  margin logic, private file references, or customer data in public responses.

Price ranges or instant estimates are a valid future capability only when they
are explicitly scoped, tested, publicly documented, and clearly separated from
checkout or payment collection.

## Development

```bash
pnpm install
pnpm check:release
```

Useful checks:

```bash
pnpm check          # lint, tests, typecheck
pnpm check:security # audit, gitleaks, trufflehog
pnpm check:mcp      # stdio initialize, tool list, fixture discovery, path guard
pnpm check:pack     # npm tarball allowlist
```

`pnpm check:mcp` builds the server, starts it over stdio, verifies initialize and
tool metadata, creates a temporary `.stl` fixture, verifies local discovery, and
verifies files outside allowed roots are rejected before upload.

Run the live production smoke only when you intentionally want to create a real
quote request:

```bash
PRINTYOURDUCK_MCP_LIVE_SMOKE=1 \
PRINTYOURDUCK_MCP_SMOKE_EMAIL=operator@example.com \
pnpm smoke:live
```

The live smoke uploads a tiny fixture through `https://printyourduck.com`,
submits one manual quote request, and verifies `get_quote_status` returns.

## Release Checklist

Only claim npm local-helper installability after all of these pass:

```bash
pnpm check:release
npm view @printyourduck/mcp version
VERSION="$(npm view @printyourduck/mcp version)"
gh release view "mcp-v${VERSION}"
PRINTYOURDUCK_MCP_LIVE_SMOKE=1 PRINTYOURDUCK_MCP_SMOKE_EMAIL=operator@example.com pnpm smoke:live
```

Release npm package changes from this dedicated MCP repository, not from the
website repository.

The MCP Registry name is `com.printyourduck/quote`, so publication uses
domain-based HTTP authentication for `printyourduck.com`. Serve the public
`v=MCPv1; ...` record from `https://printyourduck.com/.well-known/mcp-registry-auth`
and keep the matching private key only in the `MCP_REGISTRY_PRIVATE_KEY` GitHub
Actions secret for this repository.

Only claim MCP Registry publication after this passes:

```bash
curl -f "https://registry.modelcontextprotocol.io/v0/servers/com.printyourduck%2Fquote/versions"
```

Only claim OCI/container installability after making package visibility public
and running:

```bash
VERSION="$(node -p "require('./package.json').version")"
docker manifest inspect "ghcr.io/printyourduck/printyourduck-mcp:${VERSION}"
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Good first areas include client setup
docs, path-safety hardening, MCP metadata safety, package release checks, and
public-safe examples.

For security issues, see [SECURITY.md](SECURITY.md). Do not include secrets,
customer files, private file references, supplier/cost/margin details, or
dashboard screenshots in public issues.
