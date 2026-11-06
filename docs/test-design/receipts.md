# Test design: receipts

Area: `POST /purchase-orders/{poId}/receive`.

Sources: `docs/API.md` (Basics, Errors, The purchase-to-pay flow, Business rules, Endpoints / Purchase orders, A full session with curl), OpenAPI `/purchase-orders/{poId}/receive`, schemas `ReceiveRequest`, `PurchaseOrder`, `PoLine`, `Error`, and `docs/QUESTIONS.md` §4.

Prerequisite for every case that depends on known seed state: `POST /admin/reset` first.

Setup shorthand used below (unless a row says otherwise): create a draft PO with `vnd-001` and the listed lines → `POST .../submit` → then the receive under test.

---

## POST /purchase-orders/{poId}/receive

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| RCV-01 | positive | Setup: one line `LUM-2X4-8` qty 10 @ 4.75, submitted. Body: `{"items":[{"sku":"LUM-2X4-8","quantity":10}]}` | 200 | `PurchaseOrder`: same `id`/`vendor_id`; `status:"closed"`; line `received_quantity:10`; `ordered_value:47.5`; `received_value:47.5`; `fully_received:true` | API.md Endpoints / Purchase orders + curl session; OpenAPI “closes when every line is fully received”; `PurchaseOrder` | happy path / documented example |
| RCV-02 | positive | Setup: two lines (LUM qty 10 @ 4.75, CEM qty 4 @ 11.9), submitted. Partial: `{"items":[{"sku":"LUM-2X4-8","quantity":5}]}` | 200 | `status:"submitted"` (not closed); LUM `received_quantity:5`; CEM `received_quantity:0`; `received_value:23.75`; `fully_received:false` | API.md flow (“Deliveries can be partial”); OpenAPI receive description | documented option / partial delivery |
| RCV-03 | positive | Setup as RCV-02. First receive LUM 5; second receive `{"items":[{"sku":"LUM-2X4-8","quantity":5},{"sku":"CEM-30KG","quantity":4}]}` | 200 | After second call: both lines fully received; `status:"closed"`; `received_value:95.1`; `fully_received:true` | API.md “across all deliveries” + closes when fully received; OpenAPI | state / accumulate then close |
| RCV-04 | positive | Setup: one line qty 10. Receive remaining in two equal parts: qty 5 then qty 5 | 200 | After first: `status:"submitted"`, `received_quantity:5`, `fully_received:false`; after second: `status:"closed"`, `received_quantity:10`, `fully_received:true`, `received_value` equals `ordered_value` | API.md partial + close on full; `receive_quantity_limit` promise | state / two partials to close |
| RCV-05 | positive | Setup: two lines. Receive only CEM full qty 4 (leave LUM at 0): `{"items":[{"sku":"CEM-30KG","quantity":4}]}` | 200 | `status:"submitted"`; CEM `received_quantity:4`; LUM `received_quantity:0`; `fully_received:false`; `received_value:47.6` | API.md partial deliveries; OpenAPI | equivalence / subset of lines |
| RCV-06 | positive | Setup: line qty 10. Receive `quantity:1` (smallest valid delivery qty) | 200 | Line `received_quantity:1`; `status:"submitted"`; `fully_received:false`; `received_value` = 1 × unit_price | OpenAPI `ReceiveRequest` quantity `exclusiveMinimum:0`; API.md “greater than 0” | boundary (smallest valid) |
| RCV-07 | positive | Setup: line `quantity:10000`, `unit_price:1`, submitted. Receive `{"items":[{"sku":"...","quantity":10000}]}` | 200 | `received_quantity:10000`; `status:"closed"`; `fully_received:true`; `received_value:10000` | OpenAPI quantity `maximum:10000`; API.md line limits on deliveries | boundary (exactly at schema limit / full receive) |
| RCV-08 | error | `POST /purchase-orders/po-does-not-exist/receive` with `{"items":[{"sku":"LUM-2X4-8","quantity":1}]}` | 404 | `detail` present; `rule` absent | API.md Errors; OpenAPI `/receive` 404 | unknown id |
| RCV-09 | error | Setup: draft PO (do **not** submit). Receive valid full qty for its line | 400 | `detail` present; `rule:"workflow_gate"` | API.md Business rules #10 (“receive only on a submitted PO”); OpenAPI description | state / wrong order |
| RCV-10 | error | Setup: submitted, line qty 10. Receive `quantity:11` | 400 | `detail` present; `rule:"receive_quantity_limit"` | API.md Business rules #2; OpenAPI “never exceed the ordered quantity” | boundary (one over ordered) |
| RCV-11 | error | Setup: submitted, line qty 10. Receive qty 6, then receive qty 5 (cumulative 11) | 400 | Second call: `detail` present; `rule:"receive_quantity_limit"`; first call left `received_quantity:6` | API.md “across all deliveries”; OpenAPI | state / accumulate one over |
| RCV-12 | error | Setup: submitted, line qty 10. Receive exactly 10 (PO closes), then receive qty 1 again | — | — After a PO is `closed`, can further receive attempts occur, and what `rule`/status is returned? | QUESTIONS.md §4; API.md workflow_gate wording overlaps | assumed — ask |
| RCV-13 | negative | Setup: submitted PO. Body `{}` (missing `items`) | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `ReceiveRequest` required `items`; API.md Errors | equivalence class (missing field) |
| RCV-14 | negative | Setup: submitted PO. `{"items":[]}` | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `items` `minItems:1` | boundary (one under min items) |
| RCV-15 | negative | Setup: submitted PO. Item missing `sku`: `{"items":[{"quantity":1}]}` | 400 | `detail` present; `rule:"validation_error"` | OpenAPI item required `sku` | equivalence class (missing field) |
| RCV-16 | negative | Setup: submitted PO. Item missing `quantity`: `{"items":[{"sku":"LUM-2X4-8"}]}` | 400 | `detail` present; `rule:"validation_error"` | OpenAPI item required `quantity` | equivalence class (missing field) |
| RCV-17 | negative | Setup: submitted PO with LUM. `sku:""` | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `sku` `minLength:1` | equivalence class (empty string) |
| RCV-18 | negative | Setup: submitted, line qty 10. Receive `quantity:0` | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `exclusiveMinimum:0`; API.md delivery quantity limits | boundary (zero / one under) |
| RCV-19 | negative | Setup: submitted PO. Receive `quantity:-1` | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `exclusiveMinimum:0` | equivalence class (negative number) |
| RCV-20 | negative | Setup: submitted PO. Receive `quantity:10001` | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `maximum:10000`; API.md “at most 10,000” on deliveries | boundary (one over schema limit) |
| RCV-21 | negative | Setup: submitted PO. Wrong types: `quantity:"10"` (string) or `sku:123` | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `ReceiveRequest` types | equivalence class (wrong type) |
| RCV-22 | negative | Setup: submitted PO with only `LUM-2X4-8`. Receive SKU not on PO: `{"items":[{"sku":"CEM-30KG","quantity":1}]}` | 400 | `detail` present; `rule:"validation_error"` (API.md requires every SKU on the PO; no separate named receive rule) | API.md “Every SKU must be on the PO”; OpenAPI 400 “Invalid body…” | equivalence class (SKU not on PO) |
| RCV-23 | assumed — ask | Setup: submitted, line qty 10. Receive `quantity:0.5` | — | — Are fractional/decimal quantities allowed, or must `quantity` be a whole number? | QUESTIONS.md §4 | not documented |
| RCV-24 | assumed — ask | Setup: submitted multi-line PO. Very large `items` array (many entries) | — | — Is there a maximum number of line items on a delivery? | QUESTIONS.md §4 | not documented |
| RCV-25 | assumed — ask | Setup: submitted PO. Valid body without `Content-Type: application/json` (or wrong content type) | — | — What response is returned when `Content-Type` is missing or is not `application/json`? | QUESTIONS.md §4; API.md Basics | not documented |
| RCV-26 | assumed — ask | Setup: submitted PO with LUM. Two items same SKU in one request: `{"items":[{"sku":"LUM-2X4-8","quantity":3},{"sku":"LUM-2X4-8","quantity":2}]}` | — | — May the same SKU appear more than once in a single receive `items` array? (invoice forbids duplicates via `invoice_line_validation`; receive has no parallel named rule) | QUESTIONS.md §4 (related gaps); API.md invoice vs receive wording | not documented |
| RCV-27 | assumed — ask | Setup: submitted PO. Receive with very long `sku` string | — | — What is the maximum length for `sku`? | QUESTIONS.md §4 | not documented |

---

## Coverage notes

| Endpoint | Business rules that apply | Covered by |
| --- | --- | --- |
| `POST /purchase-orders/{poId}/receive` | `workflow_gate` | RCV-09 (draft); RCV-12 asks for closed |
| | `receive_quantity_limit` | RCV-10, RCV-11 |
| | `validation_error` | RCV-13 … RCV-22 |

Close-on-full-receipt behavior is covered by RCV-01, RCV-03, RCV-04 (positive). Partial deliveries: RCV-02, RCV-05.
