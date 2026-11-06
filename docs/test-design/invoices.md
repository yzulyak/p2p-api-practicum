# Test design: invoices

Area: `POST /invoices`, `GET /invoices/{invoiceId}`, `POST /invoices/{invoiceId}/match`.

Sources: `docs/API.md` (Basics, Errors, The purchase-to-pay flow, Business rules, Endpoints / Invoices, A full session with curl), OpenAPI `/invoices`, `/invoices/{invoiceId}`, `/invoices/{invoiceId}/match`, schemas `Invoice`, `InvoiceCreate`, `InvoiceLine`, `MatchResult`, `Error`, and `docs/QUESTIONS.md` §4.

Prerequisite for every case that depends on known seed state: `POST /admin/reset` first.

Setup shorthand used below (unless a row says otherwise): create a draft PO with `vnd-001` and the listed lines → `POST .../submit` → receive as stated → then the invoice/match call under test. Use a unique `invoice_number` per create (e.g. `INV-{Date.now()}`) except where the case intentionally reuses a number.

Out of scope for this area: `POST /invoices/{invoiceId}/approve` (separate design).

---

## POST /invoices

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| INV-C-01 | positive | Setup: one line LUM qty 10 @ 4.75, submitted, fully received. Body: `{"po_id":"<id>","invoice_number":"INV-1001","line_items":[{"sku":"LUM-2X4-8","quantity":10,"unit_price":4.75}]}` | 201 | `Invoice`: `id` starts with `inv-`; `po_id`/`vendor_id:"vnd-001"`; `invoice_number:"INV-1001"`; `status:"received"`; `matched:false`; `partial_receipt:null`; one line; `total_amount:47.5` | API.md Endpoints / Invoices + curl session; OpenAPI `Invoice` | happy path / documented example |
| INV-C-02 | positive | Setup: two lines (LUM 10 @ 4.75, CEM 4 @ 11.9), fully received (PO closed). Invoice both lines at PO prices | 201 | `status:"received"`; `matched:false`; `partial_receipt:null`; two lines; `total_amount:95.1`; `vendor_id:"vnd-001"` | API.md Invoices example body; OpenAPI “submitted or closed” | documented option / closed PO |
| INV-C-03 | positive | Setup: submitted PO, receive LUM 10 only (CEM still 0 if multi-line — use single-line PO). Invoice qty less than received: qty 5 @ 4.75 | 201 | `status:"received"`; `total_amount:23.75`; `matched:false`; `partial_receipt:null` | API.md overpayment_protection (“never exceeds”); OpenAPI | equivalence / under received |
| INV-C-04 | positive | Setup: submitted, fully received qty 10. Invoice `quantity:1` (smallest valid) @ 4.75 | 201 | Line `quantity:1`; `total_amount:4.75`; `status:"received"` | OpenAPI `InvoiceLine.quantity` `exclusiveMinimum:0`; API.md limits | boundary (smallest valid qty) |
| INV-C-05 | positive | Setup: submitted, fully received. Invoice `unit_price:0`, `quantity:1` | 201 | Line `unit_price:0`; `total_amount:0`; `status:"received"` | OpenAPI `unit_price` `minimum:0`; API.md “from 0” | boundary (smallest valid price) |
| INV-C-06 | positive | Setup: PO line qty 10000 @ 1, submitted, fully received. Invoice same qty/price | 201 | Line `quantity:10000`; `total_amount:10000`; `status:"received"` | OpenAPI `maximum:10000` / `100000`; API.md | boundary (exactly at qty limit) |
| INV-C-07 | positive | Setup: submitted PO (not fully received — stay `submitted`). Invoice against remaining/received amounts that stay within received | 201 | `status:"received"`; create allowed on submitted PO | API.md workflow_gate “invoice only a submitted or closed PO”; OpenAPI `/invoices` | state / submitted (not closed) |
| INV-C-08 | error | `po_id:"po-does-not-exist"` with valid `invoice_number` and one valid line | 404 | `detail` present; `rule` absent | API.md Errors; OpenAPI `/invoices` 404 “Purchase order not found” | unknown id |
| INV-C-09 | error | Setup: draft PO only (do **not** submit). Invoice valid full line for that PO | 400 | `detail` present; `rule:"workflow_gate"` | API.md Business rules #10 + Endpoints / Invoices; OpenAPI description | state / wrong order |
| INV-C-10 | error | Setup: submitted, receive qty 10. Invoice `quantity:11` @ same unit_price | 400 | `detail` present; `rule:"overpayment_protection"` | API.md Business rules #3 (“not per line quantity”); OpenAPI | boundary (one unit over received) |
| INV-C-11 | error | Setup: submitted, receive qty 10 @ 4.75. Invoice qty 10 @ `unit_price:4.76` (total one cent over received value 47.5) | 400 | `detail` present; `rule:"overpayment_protection"` | API.md #3 (“not in total value… no tolerance”); OpenAPI | boundary (one cent over received value) |
| INV-C-12 | error | Setup: submitted, receive qty 5 only (of 10). Invoice qty 6 @ PO price | 400 | `detail` present; `rule:"overpayment_protection"` | API.md #3 per-line vs received | boundary (one over partial receive) |
| INV-C-13 | error | Setup: submitted, receive qty 10. Create invoice `INV-DUP` successfully; second create same `po_id`/`invoice_number:"INV-DUP"` and valid lines within received | 400 | Second call: `detail` present; `rule:"duplicate_invoice_detection"` | API.md Business rules #6; OpenAPI | state / done twice |
| INV-C-14 | error | Setup: after successful `INV-7` for vendor. Second invoice `invoice_number:"inv-7"` (different case) | 400 | `detail` present; `rule:"duplicate_invoice_detection"` | API.md #6 case-insensitive example | equivalence class (case fold) |
| INV-C-15 | error | Setup: after successful `INV-7`. Second invoice `invoice_number:" INV-7 "` (surrounding spaces) | 400 | `detail` present; `rule:"duplicate_invoice_detection"` | API.md #6 surrounding spaces example | equivalence class (trim) |
| INV-C-16 | error | Setup: submitted, received PO with only LUM. Invoice line `sku:"CEM-30KG"` (not on PO) | 400 | `detail` present; `rule:"invoice_line_validation"` | API.md Business rules #8; OpenAPI | equivalence class (SKU not on PO) |
| INV-C-17 | error | Setup: submitted, received multi-line PO. Invoice two lines both `"sku":"LUM-2X4-8"` | 400 | `detail` present; `rule:"invoice_line_validation"` | API.md #8 “each SKU appears once”; OpenAPI | equivalence class (duplicate SKU) |
| INV-C-18 | negative | `{}` (missing `po_id`, `invoice_number`, `line_items`) | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `InvoiceCreate` required; API.md Errors | equivalence class (missing field) |
| INV-C-19 | negative | Missing `po_id` only; other fields valid against a real received PO | 400 | `detail` present; `rule:"validation_error"` | OpenAPI required `po_id` | equivalence class (missing field) |
| INV-C-20 | negative | `po_id:""` with otherwise valid body | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `po_id` `minLength:1` | equivalence class (empty string) / boundary |
| INV-C-21 | negative | Missing `invoice_number`; otherwise valid | 400 | `detail` present; `rule:"validation_error"` | OpenAPI required `invoice_number` | equivalence class (missing field) |
| INV-C-22 | negative | `invoice_number:""` | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `invoice_number` `minLength:1` | equivalence class (empty string) |
| INV-C-23 | negative | `line_items:[]` | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `line_items` `minItems:1` | boundary (one under min items) |
| INV-C-24 | negative | Line missing `sku` | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `InvoiceLine` required | equivalence class (missing field) |
| INV-C-25 | negative | Line `sku:""` | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `sku` `minLength:1` | equivalence class (empty string) |
| INV-C-26 | negative | Line missing `quantity` | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `InvoiceLine` required | equivalence class (missing field) |
| INV-C-27 | negative | Line missing `unit_price` | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `InvoiceLine` required | equivalence class (missing field) |
| INV-C-28 | negative | `quantity:0` | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `exclusiveMinimum:0`; API.md | boundary (zero / one under) |
| INV-C-29 | negative | `quantity:-1` | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `exclusiveMinimum:0` | equivalence class (negative number) |
| INV-C-30 | negative | `quantity:10001` (received enough or schema fails first) | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `maximum:10000`; API.md | boundary (one over schema limit) |
| INV-C-31 | negative | `unit_price:-0.01` | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `minimum:0`; API.md | boundary (one under min) |
| INV-C-32 | negative | `unit_price:100000.01` | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `maximum:100000`; API.md | boundary (one over limit) |
| INV-C-33 | negative | Wrong types: `quantity:"10"` or `unit_price:"4.75"` (string) | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `InvoiceLine` types number | equivalence class (wrong type) |
| INV-C-34 | assumed — ask | Setup: fully received. Invoice `unit_price` differs from PO line price but qty and total stay ≤ received (e.g. qty 10, invoice @ 4.00 vs PO 4.75) | — | — If invoice `unit_price` differs from the PO line `unit_price` but quantities and totals stay within received limits, do create and match succeed? | QUESTIONS.md §4 | not documented |
| INV-C-35 | assumed — ask | Setup: fully received. Invoice that exceeds received **quantity** or **value** when valuation uses PO vs invoice prices differently | — | — Does `overpayment_protection` compare against received quantities/values using invoice prices, PO prices, or both? | QUESTIONS.md §4 | not documented |
| INV-C-36 | assumed — ask | `quantity:0.5` on an invoice line (received ≥ 1) | — | — Are fractional/decimal quantities allowed, or must `quantity` be a whole number? | QUESTIONS.md §4 | not documented |
| INV-C-37 | assumed — ask | Very long `invoice_number` or `sku` | — | — What is the maximum length for `invoice_number` and `sku`? | QUESTIONS.md §4 | not documented |
| INV-C-38 | assumed — ask | Very large `line_items` array (many distinct SKUs on a large PO) | — | — Is there a maximum number of line items on an invoice? | QUESTIONS.md §4 | not documented |
| INV-C-39 | assumed — ask | Valid body without `Content-Type: application/json` (or wrong content type) | — | — What response is returned when `Content-Type` is missing or is not `application/json`? | QUESTIONS.md §4; API.md Basics | not documented |
| INV-C-40 | assumed — ask | Same `invoice_number` on a **different** vendor’s PO (after creating a second active vendor + its own received PO) | — | — Is duplicate detection per vendor only (API.md wording) confirmed across vendors — same number allowed for another vendor? (wording implies yes; confirm expected status/body) | QUESTIONS.md §4 / API.md #6 | not documented |
| INV-C-41 | assumed — ask | Invoice line SKU on the PO but not in the catalog | — | — May an invoice line use a SKU that is not in the catalog? | QUESTIONS.md §4 | not documented |

---

## GET /invoices/{invoiceId}

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| INV-G-01 | positive | Create invoice (as INV-C-01), then `GET /invoices/{invoiceId}` | 200 | Same shape: `status:"received"`; `matched:false`; `partial_receipt:null`; matching `po_id`, `vendor_id`, `invoice_number`, lines, `total_amount` | API.md Endpoints / Invoices; OpenAPI `Invoice` | happy path |
| INV-G-02 | positive | Create invoice → `POST .../match` → `GET` same id | 200 | `status:"matched"`; `matched:true`; `partial_receipt` boolean (not null); same `id`/`total_amount` | API.md flow received → matched; OpenAPI `status` enum + `partial_receipt` | state / after match |
| INV-G-03 | error | `GET /invoices/inv-does-not-exist` | 404 | `detail` present; `rule` absent | API.md Errors; OpenAPI `/invoices/{invoiceId}` 404 | unknown id |

No business-rule rejections on GET. No query params documented.

---

## POST /invoices/{invoiceId}/match

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| INV-M-01 | positive | Setup: fully received PO + invoice for full qty/price (as curl session). `POST /invoices/{invoiceId}/match` (no body) | 200 | `MatchResult`: `invoice_id`/`po_id` match; `status:"matched"`; `matched:true`; `partial_receipt:false`; `ordered_value`/`received_value`/`invoice_total` equal (e.g. 47.5); `message:"3-way match passed."` | API.md match example + curl; OpenAPI `MatchResult` | happy path / documented example |
| INV-M-02 | positive | Setup: multi-line PO, receive only some lines/qty so PO not fully received; invoice within received; then match | 200 | `matched:true`; `status:"matched"`; `partial_receipt:true` | API.md Business rules #5 `partial_receipt_flag`; OpenAPI match description | state / partial receipt flag |
| INV-M-03 | positive | Setup: single-line PO qty 10, receive 10 (full); invoice qty 5; match | 200 | `matched:true`; `partial_receipt:false` (every PO line fully received); `invoice_total` = invoice amount | API.md #5 (“any line of the PO is not fully received”); OpenAPI | equivalence / full PO receive, partial invoice |
| INV-M-04 | error | `POST /invoices/inv-does-not-exist/match` | 404 | `detail` present; `rule` absent | API.md Errors; OpenAPI `/match` 404 | unknown id |
| INV-M-05 | error | Create → match → approve → `POST .../match` again | 400 | `detail` present; `rule:"workflow_gate"` | API.md Business rules #10 “never match an approved invoice again”; OpenAPI 400 “already approved” | state / wrong order (after approve) |
| INV-M-06 | assumed — ask | Create → match successfully → `POST .../match` a second time (still `matched`, not approved) | — | — What happens on a second identical request (second `match` on an already-matched invoice)? | QUESTIONS.md §4 | not documented |

`partial_receipt_flag` is asserted on success (INV-M-01 … INV-M-03), not as a 400 rejection. Approve is used only as setup for INV-M-05, not as a case under test here.

---

## Coverage notes

| Endpoint | Business rules that apply | Covered by |
| --- | --- | --- |
| `POST /invoices` | `workflow_gate` | INV-C-09 |
| | `overpayment_protection` | INV-C-10, INV-C-11, INV-C-12; open questions INV-C-34, INV-C-35 |
| | `duplicate_invoice_detection` | INV-C-13, INV-C-14, INV-C-15; INV-C-40 asks cross-vendor |
| | `invoice_line_validation` | INV-C-16, INV-C-17 |
| | `validation_error` | INV-C-18 … INV-C-33 |
| `GET /invoices/{invoiceId}` | none (404 only) | INV-G-03 |
| `POST /invoices/{invoiceId}/match` | `partial_receipt_flag` (success flag) | INV-M-01, INV-M-02, INV-M-03 |
| | `workflow_gate` | INV-M-05; INV-M-06 asks rematch |

Out of scope for this area: `POST /invoices/{invoiceId}/approve` and rules `three_way_match_gate`, `duplicate_approval`, `gl_balance`, `vendor_exposure_math`.
