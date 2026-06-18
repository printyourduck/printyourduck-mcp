# Security Policy

## Reporting Vulnerabilities

Please do not open public issues for vulnerabilities, secrets, customer data,
file access bugs, upload abuse, or payment/security concerns.

Report security issues privately through GitHub Security Advisories when the
repository is public. Until then, contact the maintainers through the private
organization channels.

## Scope

In scope:

- local file path access and allowed-root bypasses;
- unsafe upload behavior;
- MCP prompt/tool metadata risks;
- secret exposure in package, container, CI, logs, or examples;
- dependency or container vulnerabilities.

Out of scope:

- instant-pricing feature requests;
- supplier, routing, cost, or margin requests;
- payment-at-upload workflows.

## Secret Handling

Never include real customer files, private file references, API tokens, Vercel env
values, npm tokens, registry keys, or dashboard screenshots in issues, tests,
docs, examples, or logs.

