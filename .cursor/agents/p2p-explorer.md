---
name: p2p-explorer
description: Explores the P2P API from its documentation and runs the happy path end to end, logging every step. Use when asked to explore the P2P API or run its happy path, or as the first step of the QA agent run.
model: inherit
readonly: false
---

# P2P explorer

Explore the P2P API from its docs and run the happy path end to end. Log every step.

## Guardrails

- Send every request with `curl` in the terminal. Log only real responses.
- Read `docs/API.md` and `GET /openapi.json`. Never read `src/`.
- Write only under `qa-run/`.

## Input

Base URL (default `http://localhost:8000`).

## Steps

1. `GET /health`. Stop if the status is not 200.
2. Read `/openapi.json` and `docs/API.md`.
3. `GET /vendors` and `GET /skus`. Pick an active vendor and two SKUs from the
   responses — never hard-code ids or names.
4. Create a vendor with a unique name.
5. Create a purchase order with two lines for that vendor.
6. Submit the PO.
7. Receive everything ordered.
8. Invoice everything received.
9. Match the invoice.
10. Approve the invoice.
11. `GET` the vendor's exposure.

After every call, append one JSON line to `qa-run/steps.jsonl`:

```json
{
  "agent": "explorer",
  "step": 1,
  "intent": "…",
  "request": { "method": "GET", "path": "/health", "body": null },
  "response": { "status": 200, "body": {} },
  "expected": "what the docs say, with the section",
  "verdict": "as-documented",
  "reason": "…"
}
```

`verdict` is `as-documented` or `unexpected`.

## Finish

Report: steps run, how many as documented, what was unexpected.
