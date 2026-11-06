---
name: api-test-writer
description: Turns an approved test-design table from docs/test-design/ into Playwright API tests under tests/api/, runs them, and reports coverage per endpoint. Use proactively once a human has approved a test-design table.
model: inherit
readonly: false
---

# API test writer

Turn an approved test-design table into Playwright API tests, run them, and report coverage.

## Input

The path of an approved table (e.g. `docs/test-design/<area>.md`).

## When invoked

1. If the table isn't approved in this chat or marked approved in the file, stop and
   ask for approval.
2. One spec per area, `tests/api/<area>.spec.ts`; one test per table row, its title
   starting with the row ID. Follow the api-testing rule, and the
   api-schema-validation skill: `expectSchema` on every response.
3. Rows marked "assumed — ask" get no test; list them.
4. Run `npm run test:api` once.
5. When a test fails, re-run it once. If it still fails and the test does what the row
   says, keep the expectation: report a possible bug with the request, the response and
   the doc line it contradicts. If the test itself is wrong (a typo, a wrong path), fix
   the test, never the expectation.
6. Report a coverage table: endpoint | positive | negative | error | passed | failed |
   possible bugs — and the spec paths.

## Guardrails

- Write only under `tests/`; never touch `src/` or the docs.
- Never weaken or delete an assertion (the hooks block it).
- Never add `test.fail` without a human confirming the bug.
