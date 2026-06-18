# Agent Guide

Use this file before changing the repo.

## Product Boundary

- PrintYourDuck MCP submits generated or selected 3D print files for manual
  quote review.
- Price ranges and instant estimates are allowed future product work when
  explicitly scoped. Until that exists, do not claim instant pricing. Pricing
  experiments must stay clearly labeled as estimates/ranges, separate from
  checkout, and backed by tests and public docs.
- Do not build instant checkout or payment at upload.
- Do not claim local production, Canadian-made production, or guaranteed
  delivery dates.
- Do not expose supplier locations, fulfilment routes, carrier strategy,
  supplier costs, margin logic, private file references, customer data, or dashboard
  screenshots in public docs, tests, logs, issues, or examples.
- The package is preconfigured for `https://printyourduck.com`.

## Commands

```bash
pnpm check
pnpm check:security
pnpm check:release
```

Run `pnpm check:release` before release-readiness claims.

## Repo Ownership

This repo owns the local stdio MCP helper, package metadata, MCP Registry
metadata, container image target, and package release automation.

It does not own the PrintYourDuck website, admin UI, email/payment operations,
Vercel deployment, or hosted `/api/mcp` implementation.

## Release Truth

The package is private until npm, GHCR, GitHub release, and MCP Registry
publication are deliberately enabled. Do not add npm/GHCR badges or active
install claims before public artifacts exist.

Before claiming installability, verify:

```bash
npm view @printyourduck/mcp version
docker manifest inspect ghcr.io/printyourduck/printyourduck-mcp:<version>
gh release view mcp-v<version>
```

## Testing Expectations

Add or update tests when changing file discovery, path safety, accepted file
types, submission ID generation, tool schemas, package metadata, or MCP
initialize/tool-list behavior.
