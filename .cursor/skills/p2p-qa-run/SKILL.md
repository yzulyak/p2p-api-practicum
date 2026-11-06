---
name: p2p-qa-run
description: Runs the P2P QA agent — the explorer, then the adversary, then the judge — and shows the report. Use when the user asks to run the QA agent, test the P2P API on its own, run the challenge, or check the business rules end to end against a running API.
---

# P2P QA run

Run the P2P QA agent — explorer, then adversary, then judge — and show the report.

## Guardrails

- Every request the agents send goes through `curl` in the terminal.
- None of them reads `src/`. They write only in `qa-run/`.
- Fix nothing, write no tests, file no bugs: those are separate steps a human starts.

## Steps

1. `GET <base URL>/health` (default base URL `http://localhost:8000`). If it is down,
   tell the user to run `npm start` and stop.
2. Empty `qa-run/` (it holds run output only).
3. `POST /admin/reset`.
4. Run the `p2p-explorer` subagent with the base URL and wait.
5. Run the `p2p-adversary` subagent with the base URL and wait.
6. Run the `p2p-judge` subagent with the base URL.
7. Show the happy path status, the rule table, and the path to `qa-run/report.json`.
