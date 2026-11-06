---
name: api-test-design
description: Designs API test cases as a table a human approves, from docs/API.md and /openapi.json, before any test code exists. Use when the user asks what to test for an endpoint or an area of the API, asks for test cases, test ideas, a test plan or coverage, or names an endpoint they want covered. Writes docs/test-design/<area>.md and stops for approval. Do NOT use to write test code — that is the api-test-writer subagent.
paths: "docs/**, tests/**"
---

# API test design

Design API test cases as an approval table from `docs/API.md` and `/openapi.json`. Write no test code.

## Steps

1. Read the endpoints of the area in both documents and in docs/QUESTIONS.md.
2. Write docs/test-design/<area>.md, one table per endpoint:
   ID | type (positive / negative / error) | what we send | expected status |
   expected body (rule, key values) | source (API.md section or OpenAPI schema) | technique
3. Positive: the main success case, plus one row per documented option or default.
4. Negative, with the technique named in its column:
   - boundary values: 0, the smallest valid value, exactly at a limit, one over it
     (one unit more than ordered, one cent more than received);
   - equivalence classes: one row per kind of bad input (missing field, empty string,
     wrong type, negative number);
   - state: the step done in the wrong order or done twice.
5. Errors: an unknown id → 404 with no rule; every business rule in API.md that
   touches the endpoint gets at least one row that tries to break it → 400 with that rule.
6. Not documented: a row marked "assumed — ask" with the question from QUESTIONS.md,
   and no expected result.
7. Stop. Show the table and wait for the human to answer "approved" or ask for changes.
   Write no test code.
