# API test coverage

Source of paths/methods: `GET http://localhost:8000/openapi.json`.  
Counts are implemented Playwright tests classified as positive / negative / error (from `docs/test-design/` where a design exists; otherwise by the same rules). Assumed-ask design rows have no tests and are not counted.  
`Schema-checked` is **yes** only when every response body in those tests is validated with `expectSchema` against `/openapi.json`.

## Coverage by endpoint

| Method | Path | Positive | Negative | Error | Schema-checked | Spec file |
| --- | --- | ---: | ---: | ---: | --- | --- |
| `GET` | `/health` | 1 | 0 | 0 | no | `tests/api/health.spec.ts` |
| `POST` | `/admin/reset` | 1 | 0 | 0 | no | `tests/api/reset.setup.ts` |
| `GET` | `/vendors` | 2 | 0 | 0 | yes | `tests/api/vendors-and-catalog.spec.ts` |
| `POST` | `/vendors` | 4 | 5 | 0 | yes | `tests/api/vendors-and-catalog.spec.ts` |
| `GET` | `/skus` | 2 | 0 | 0 | yes | `tests/api/vendors-and-catalog.spec.ts` |
| `POST` | `/purchase-orders` | 7 | 14 | 2 | yes | `tests/api/purchase-orders.spec.ts` |
| `GET` | `/purchase-orders/{poId}` | 2 | 0 | 1 | yes | `tests/api/purchase-orders.spec.ts` |
| `POST` | `/purchase-orders/{poId}/submit` | 1 | 0 | 3 | yes | `tests/api/purchase-orders.spec.ts` |
| `POST` | `/purchase-orders/{poId}/receive` | 7 | 10 | 4 | yes | `tests/api/receipts.spec.ts` |
| `POST` | `/invoices` | 7 | 16 | 10 | yes | `tests/api/invoices.spec.ts` |
| `GET` | `/invoices/{invoiceId}` | 2 | 0 | 1 | yes | `tests/api/invoices.spec.ts` |
| `POST` | `/invoices/{invoiceId}/match` | 3 | 0 | 2 | yes | `tests/api/invoices.spec.ts` |
| `POST` | `/invoices/{invoiceId}/approve` | 6 | 0 | 3 | yes | `tests/api/approval-and-exposure.spec.ts` |
| `GET` | `/vendors/{vendorId}/exposure` | 8 | 0 | 1 | yes | `tests/api/approval-and-exposure.spec.ts` |

Notes:

- `POST /admin/reset` is the project setup project (`reset API to seed state`), not an `@api` case from a design table. It asserts status `200` only.
- `GET /health` asserts `{ status: "ok" }` but does not call `expectSchema` (`Health`).
- `tests/api/schema.spec.ts` exercises the `expectSchema` helper; it is not counted above.

## Endpoints with a zero in any column

| Method | Path | Zero column(s) |
| --- | --- | --- |
| `GET` | `/health` | negative, error |
| `POST` | `/admin/reset` | negative, error |
| `GET` | `/vendors` | negative, error |
| `POST` | `/vendors` | error |
| `GET` | `/skus` | negative, error |
| `GET` | `/purchase-orders/{poId}` | negative |
| `POST` | `/purchase-orders/{poId}/submit` | negative |
| `GET` | `/invoices/{invoiceId}` | negative |
| `POST` | `/invoices/{invoiceId}/match` | negative |
| `POST` | `/invoices/{invoiceId}/approve` | negative |
| `GET` | `/vendors/{vendorId}/exposure` | negative |

No OpenAPI path/method has zero **positive** tests.

## Possible bugs reported by runs so far

From api-test-writer runs (expectations kept; no `test.fail`). Re-checked: the three cases below still fail (`Expected: 400`, `Received: 201`).

| Test title | Possible bug |
| --- | --- |
| `INV-C-11 POST /invoices unit_price one cent over returns overpayment_protection` | Docs (`overpayment_protection`): invoice total must not exceed received value, no tolerance. Fully received qty 10 @ 4.75 (`received_value` 47.5); `POST /invoices` with qty 10 @ `unit_price: 4.76`. Expected `400` + `rule: "overpayment_protection"`. Actual `201` with `total_amount: 47.6`. |
| `INV-C-14 POST /invoices case-insensitive duplicate invoice_number` | Docs (`duplicate_invoice_detection`): invoice numbers unique per vendor, compared case-insensitively. Create with `INV-7-…`, then same number lowercased. Expected `400` + `rule: "duplicate_invoice_detection"`. Actual `201` (second invoice created). |
| `INV-C-15 POST /invoices trimmed-space duplicate invoice_number` | Docs (`duplicate_invoice_detection`): surrounding spaces ignored. Create with `INV-7-…`, then ` INV-7-… `. Expected `400` + `rule: "duplicate_invoice_detection"`. Actual `201` (second invoice created). |

No other possible bugs were reported from the vendors-and-catalog, purchase-orders, receipts, or approval-and-exposure runs.
