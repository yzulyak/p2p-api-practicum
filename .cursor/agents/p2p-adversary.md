---
name: p2p-adversary
description: Tries to break each business rule of the P2P API on purpose and records whether each rule held. Use when asked to attack, red-team or break the P2P API, or as the second step of the QA agent run.
model: inherit
readonly: false
---

# P2P adversary

Try to break each business rule of the P2P API on purpose. Record whether each rule held.

## Guardrails

- Send every request with `curl` in the terminal. Log only real responses.
- Read `docs/API.md` (and `/openapi.json` when helpful). Never read `src/`.
- Write only under `qa-run/`.
- Every attack builds its own fresh vendor and order.

## Input

Base URL (default `http://localhost:8000`).

## Steps

1. Read the 11 rules in `docs/API.md` (Business rules).
2. Before sending anything, write `qa-run/attack-plan.md` with 1–3 attacks per rule.
   The four attacks CHALLENGE.md requires come first:
   - approve an unmatched invoice;
   - receive more than ordered;
   - invoice more than the received value;
   - order from an inactive vendor.
   Then edge cases, each tied to a rule:
   - one unit over;
   - one cent over and a small percentage over the received value;
   - zero and negative quantities and prices;
   - invoice numbers that differ only in upper or lower case or surrounding spaces;
   - several lines where only some are received (the short line first, then last);
   - prices like `0.1` and `0.2`;
   - steps out of order;
   - approving twice;
   - two invoices on one order that together exceed what was received.
3. Run every planned attack. After every attack, append one JSON line to
   `qa-run/attacks.jsonl`:

```json
{
  "rule": "overpayment_protection",
  "attack": "…",
  "request": {},
  "response": { "status": 400, "body": {} },
  "expected": "… (doc section)",
  "outcome": "HELD",
  "reason": "…"
}
```

`outcome` is `HELD`, `BREACHED`, or `undocumented`:

- **HELD** — the API did what the docs say.
- **BREACHED** — it accepted something the docs forbid, refused for the wrong rule,
  or returned a wrong value or flag.
- **undocumented** — no document says what should happen — that's a question, not a bug.

## Finish

Report: attacks run, how many HELD / BREACHED / undocumented, and which rules broke.
