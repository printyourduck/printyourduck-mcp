# Contributing

Thanks for helping improve PrintYourDuck MCP.

Before opening a pull request:

1. Keep current public behavior honest: no instant-pricing claims unless that
   feature is explicitly scoped and implemented. Price-range work is welcome
   when it is labeled as estimates/ranges, tested, and kept separate from
   checkout/payment at upload.
2. Keep the package preconfigured for `https://printyourduck.com`.
3. Do not add private operational details, supplier/cost/margin logic, customer
   files, secrets, or dashboard screenshots.
4. Run:

   ```bash
   pnpm check:release
   ```

Useful contribution areas:

- MCP client setup docs;
- file discovery and path-safety hardening;
- package release automation;
- prompt/tool metadata safety;
- tests and public-safe examples.
