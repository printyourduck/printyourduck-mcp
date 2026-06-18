# PrintYourDuck MCP

[![CI](https://github.com/printyourduck/printyourduck-mcp/actions/workflows/checks.yml/badge.svg)](https://github.com/printyourduck/printyourduck-mcp/actions/workflows/checks.yml)
[![Security](https://github.com/printyourduck/printyourduck-mcp/actions/workflows/security.yml/badge.svg)](https://github.com/printyourduck/printyourduck-mcp/actions/workflows/security.yml)
[![MCP](https://img.shields.io/badge/MCP-com.printyourduck%2Fquote-blue)](https://printyourduck.com/server.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Local MCP helper for submitting generated 3D print files to PrintYourDuck manual
quote review.

This server is for local coding-agent workflows where an agent can see files on
disk, such as Codex CLI, Claude Code, Cursor, or other MCP hosts. It uploads the
selected file through PrintYourDuck's private upload flow, then submits the
manual quote request. It does not return instant pricing and does not collect
payment today.

The package is preconfigured for `https://printyourduck.com`; customers do not
need to supply an API URL.

Publication status: the local helper package is not public yet. Until npm,
GHCR, GitHub release, and MCP Registry artifacts exist, keep install examples
marked as post-publication examples and use the remote MCP endpoint.

<!-- mcp-name: com.printyourduck/quote -->

## Install After Publication

```bash
npx -y @printyourduck/mcp
```

Most MCP clients accept a configuration shaped like this:

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

Docker after publication:

```bash
docker run --rm -i ghcr.io/printyourduck/printyourduck-mcp:<version>
```

Remote-capable clients can connect to:

```text
https://printyourduck.com/api/mcp
```

## What This Does

- Finds recent printable files in a local project.
- Uploads one selected file through PrintYourDuck's private upload flow.
- Creates a manual quote review request.
- Reuses a stable submission ID on retry to avoid duplicate requests.

## What This Does Not Do

- It does not calculate instant pricing today.
- It does not collect payment at upload.
- It does not automate checkout.
- It does not expose private operational details.

## Pricing Roadmap

Price ranges or instant estimates are a valid future capability, but they need a
separate, explicit product scope. Any estimate/range tool should be tested,
publicly documented, and clearly separated from checkout or payment collection.

## Tools

- `find_recent_printable_files`: find recent `.stl`, `.step`, `.stp`, `.3mf`,
  `.obj`, or `.zip` files under a project directory.
- `submit_local_file_for_quote`: upload one selected local file privately and
  submit it for manual quote review.

`submit_local_file_for_quote` derives a stable `submissionId` from the selected
file and quote details unless the caller provides one. Reuse that ID on retry to
avoid duplicate manual quote requests.

## Guardrails

This server preserves the PrintYourDuck manual quote boundary:

- no instant pricing;
- no payment at upload;
- no private operational details in public responses.

## Support

Open an issue at:

```text
https://github.com/printyourduck/printyourduck-mcp/issues
```

Please do not include secrets, customer files, private file references, or sensitive
business details in public issues.
