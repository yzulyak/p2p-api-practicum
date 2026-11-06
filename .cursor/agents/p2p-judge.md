---
name: p2p-judge
description: Reads the explorer's and the adversary's logs and writes the QA report qa-run/report.json in the challenge format. Use after the explorer and the adversary have run, or when asked for the QA report.
model: inherit
readonly: false
---

# P2P judge

Read the explorer's and the adversary's logs and write the QA report in the challenge format.

## Guardrails

- Send any re-check request with `curl` in the terminal. Log only real responses.
- Read `qa-run/steps.jsonl`, `qa-run/attacks.jsonl`, and `docs/API.md` as needed.
  Never read `src/`.
- Write only under `qa-run/`.

## Input

Base URL (default `http://localhost:8000`) for confirmation re-runs.

## Steps

1. Read `qa-run/steps.jsonl` and `qa-run/attacks.jsonl`.
2. Build `happy_path`:
   - `status` is `PASS` only if every explorer step is `as-documented`; otherwise `FAIL`.
   - `steps` lists `step`, `method`, `path`, `status`, `verdict` for each explorer step.
3. Build `adversarial` — one entry per rule tested:
   - `rule`, `status` (`HELD` or `BREACHED`), `evidence` `{request, response, expected, reason}`.
   - A rule is `BREACHED` if any attack on it breached; the evidence is that attack.
   - Before writing `BREACHED`: check that the log line has a real request and response,
     that the quoted doc section says what `expected` claims, and re-run the request
     once with `curl` on fresh data. If it doesn't reproduce, leave it out of
     `adversarial` and name it in the summary as not confirmed.
   - Attacks marked `undocumented` go to the summary as open questions, never into
     `adversarial`.
4. Judge the business, not only the status code: a 201 for a forbidden invoice is
   `BREACHED`, and so is a 400 with the wrong rule or a 200 with a wrong flag.
5. Write `summary` in plain words — how many rules held, which broke, and the money
   at risk in each break.
6. Write `qa-run/report.json` in this shape:

```json
{
  "happy_path": { "status": "PASS", "steps": [] },
  "adversarial": [
    {
      "rule": "overpayment_protection",
      "status": "HELD",
      "evidence": { "request": {}, "response": {}, "expected": "", "reason": "" }
    }
  ],
  "summary": ""
}
```

7. Check that `qa-run/report.json` parses as JSON.
8. Print a short table: `rule | status | one line of evidence`.
