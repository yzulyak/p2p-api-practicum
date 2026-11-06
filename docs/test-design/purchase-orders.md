# Test design: purchase-orders

Area: `POST /purchase-orders`, `GET /purchase-orders/{poId}`, `POST /purchase-orders/{poId}/submit`.

Sources: `docs/API.md` (Basics, Errors, The purchase-to-pay flow, Seed data, Business rules, Endpoints / Purchase orders), OpenAPI `/purchase-orders`, `/purchase-orders/{poId}`, `/purchase-orders/{poId}/submit`, schemas `PurchaseOrder`, `PurchaseOrderCreate`, `PoLine`, `PoLineCreate`, `Error`, and `docs/QUESTIONS.md` §4.

Prerequisite for every case that depends on known seed state: `POST /admin/reset` first.

Out of scope for this area: `POST /purchase-orders/{poId}/receive` (separate design).

---

## POST /purchase-orders

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| PO-C-01 | positive | `{"vendor_id":"vnd-001","line_items":[{"sku":"LUM-2X4-8","description":"2x4 stud, 8 ft","quantity":10,"unit_price":4.75},{"sku":"CEM-30KG","quantity":4,"unit_price":11.9}]}` | 201 | `PurchaseOrder`: `id` starts with `po-`; `vendor_id:"vnd-001"`; `status:"draft"`; two lines with `received_quantity:0`; missing description on CEM defaults to `""`; `ordered_value:95.1`; `received_value:0`; `fully_received:false` | API.md Endpoints / Purchase orders (example); OpenAPI `PurchaseOrder` / `PoLineCreate.description` default | happy path / documented example |
| PO-C-02 | positive | Single line, no `description`: `{"vendor_id":"vnd-001","line_items":[{"sku":"LUM-2X4-8","quantity":10,"unit_price":4.75}]}` | 201 | `status:"draft"`; one line with `description:""`, `received_quantity:0`; `ordered_value:47.5`; `received_value:0`; `fully_received:false` | API.md “description is optional”; OpenAPI `PoLineCreate.description` default `""` | documented option / default |
| PO-C-03 | positive | `unit_price` different from catalog: `{"vendor_id":"vnd-001","line_items":[{"sku":"LUM-2X4-8","quantity":10,"unit_price":5.00}]}` (catalog is 4.75) | 201 | Line `unit_price:5`; `ordered_value:50`; PO carries its own price | API.md Seed data (“catalog is for reference… carries its own unit_price”) | documented option |
| PO-C-04 | positive | Quantity at upper limit: `quantity:10000`, `unit_price:1` | 201 | Line `quantity:10000`; `status:"draft"` | API.md “at most 10,000”; OpenAPI `PoLineCreate.quantity` `maximum:10000` | boundary (exactly at limit) |
| PO-C-05 | positive | `unit_price:0`, `quantity:1` | 201 | Line `unit_price:0`; `ordered_value:0`; `status:"draft"` | API.md “unit_price from 0”; OpenAPI `PoLineCreate.unit_price` `minimum:0` | boundary (smallest valid price) |
| PO-C-06 | positive | `unit_price:100000`, `quantity:1` | 201 | Line `unit_price:100000`; `ordered_value:100000`; `status:"draft"` | API.md “to 100,000”; OpenAPI `PoLineCreate.unit_price` `maximum:100000` | boundary (exactly at limit) |
| PO-C-07 | positive | Newly created active vendor (not seed): `POST /vendors` then create PO with that `vendor_id` and one valid line | 201 | `vendor_id` equals the new vendor’s id; `status:"draft"` | API.md inactive_vendor_gate (active allowed); Endpoints / Vendors | state / non-seed active vendor |
| PO-C-08 | error | `vendor_id:"vnd-002"` (seed inactive) with one valid line | 400 | `detail` present; `rule:"inactive_vendor_gate"` | API.md Business rules #1 + Endpoints / Purchase orders; OpenAPI `/purchase-orders` 400 | business rule |
| PO-C-09 | error | `vendor_id:"vnd-does-not-exist"` with one valid line | 404 | `detail` present; `rule` absent | API.md Errors + Endpoints / Purchase orders (“vendor must exist (404)”); OpenAPI 404 | unknown id |
| PO-C-10 | negative | `{}` (missing `vendor_id` and `line_items`) | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `PurchaseOrderCreate` required; API.md Errors | equivalence class (missing field) |
| PO-C-11 | negative | `{"vendor_id":"","line_items":[{"sku":"LUM-2X4-8","quantity":1,"unit_price":1}]}` | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `vendor_id` `minLength:1` | equivalence class (empty string) / boundary |
| PO-C-12 | negative | `{"vendor_id":"vnd-001","line_items":[]}` | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `line_items` `minItems:1` | boundary (one under min items) / equivalence class |
| PO-C-13 | negative | Missing line `sku`: `{"vendor_id":"vnd-001","line_items":[{"quantity":1,"unit_price":1}]}` | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `PoLineCreate` required `sku` | equivalence class (missing field) |
| PO-C-14 | negative | `sku:""` on a line | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `PoLineCreate.sku` `minLength:1` | equivalence class (empty string) |
| PO-C-15 | negative | Missing `quantity` on a line | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `PoLineCreate` required | equivalence class (missing field) |
| PO-C-16 | negative | Missing `unit_price` on a line | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `PoLineCreate` required | equivalence class (missing field) |
| PO-C-17 | negative | `quantity:0` | 400 | `detail` present; `rule:"validation_error"` | API.md “greater than 0”; OpenAPI `exclusiveMinimum:0` | boundary (one under / zero) |
| PO-C-18 | negative | `quantity:-1` | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `exclusiveMinimum:0`; API.md | equivalence class (negative number) |
| PO-C-19 | negative | `quantity:10001` | 400 | `detail` present; `rule:"validation_error"` | API.md “at most 10,000”; OpenAPI `maximum:10000` | boundary (one over limit) |
| PO-C-20 | negative | `unit_price:-0.01` | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `unit_price` `minimum:0`; API.md | boundary (one under min) / negative |
| PO-C-21 | negative | `unit_price:100000.01` | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `maximum:100000`; API.md | boundary (one over limit) |
| PO-C-22 | negative | Wrong types: `quantity:"10"` or `unit_price:"4.75"` (string) | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `PoLineCreate` types number | equivalence class (wrong type) |
| PO-C-23 | negative | Duplicate SKU on same PO: two lines both `"sku":"LUM-2X4-8"` | 400 | `detail` present; `rule:"validation_error"` (no named business rule for PO duplicate SKU) | API.md “Each SKU may appear once per PO”; OpenAPI description “Each SKU may appear once” | equivalence class (duplicate within request) |
| PO-C-24 | assumed — ask | `quantity:0.5` (fractional) | — | — Are fractional/decimal quantities allowed, or must `quantity` be a whole number? | QUESTIONS.md §4 | not documented |
| PO-C-25 | assumed — ask | Line `sku` not in catalog (e.g. `"sku":"NOT-IN-CATALOG"`) with otherwise valid body and active vendor | — | — May a PO line use a SKU that is not in the catalog? | QUESTIONS.md §4 | not documented |
| PO-C-26 | assumed — ask | Very long `description` or `sku` | — | — What is the maximum length for line `description` and `sku`? | QUESTIONS.md §4 | not documented |
| PO-C-27 | assumed — ask | Very large `line_items` array (many distinct SKUs) | — | — Is there a maximum number of line items on a PO? | QUESTIONS.md §4 | not documented |
| PO-C-28 | assumed — ask | Valid body without `Content-Type: application/json` (or wrong content type) | — | — What response is returned when `Content-Type` is missing or is not `application/json`? | QUESTIONS.md §4; API.md Basics | not documented |
| PO-C-29 | assumed — ask | Second identical create with the same body after a successful 201 | — | — What happens on a second identical request (duplicate create with the same body)? | QUESTIONS.md §4 | not documented |

---

## GET /purchase-orders/{poId}

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| PO-G-01 | positive | Create draft PO (as PO-C-02), then `GET /purchase-orders/{poId}` with returned id | 200 | Same shape as create response: `status:"draft"`; matching `vendor_id`, lines, `ordered_value`, `received_value:0`, `fully_received:false` | API.md Endpoints / Purchase orders (“returns the PO in the same shape”); OpenAPI `PurchaseOrder` | happy path |
| PO-G-02 | positive | Create draft, `POST .../submit`, then `GET` same id | 200 | `status:"submitted"`; other fields unchanged from draft (lines, values) | API.md flow draft → submitted; OpenAPI `status` enum | state / after submit |
| PO-G-03 | error | `GET /purchase-orders/po-does-not-exist` | 404 | `detail` present; `rule` absent | API.md Errors; OpenAPI `/purchase-orders/{poId}` 404 | unknown id |

No business-rule rejections on GET. No query params documented.

---

## POST /purchase-orders/{poId}/submit

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| PO-S-01 | positive | Create draft PO, then `POST /purchase-orders/{poId}/submit` (no body) | 200 | `PurchaseOrder` with `status:"submitted"`; same `id`, `vendor_id`, line items; `received_quantity` still 0; `fully_received:false` | API.md Endpoints / Purchase orders; OpenAPI `/submit` 200 | happy path |
| PO-S-02 | error | `POST /purchase-orders/po-does-not-exist/submit` | 404 | `detail` present; `rule` absent | API.md Errors; OpenAPI `/submit` 404 | unknown id |
| PO-S-03 | error | Submit an already-submitted PO (create → submit → submit again) | 400 | `detail` present; `rule:"workflow_gate"` | API.md Business rules #10 + “Anything else is rejected (rule 10)”; OpenAPI “not a draft” | state / done twice |
| PO-S-04 | error | Submit a closed PO: create → submit → receive full quantity → `POST .../submit` again | 400 | `detail` present; `rule:"workflow_gate"` | API.md workflow_gate + statuses `draft` → `submitted` → `closed`; receive closes when fully received | state / wrong order (after closed) |

`workflow_gate` is the only named business rule that rejects this endpoint. Receive is used only as setup for PO-S-04, not as a case under test here.

---

## Coverage notes

| Endpoint | Business rules that apply | Covered by |
| --- | --- | --- |
| `POST /purchase-orders` | `inactive_vendor_gate`; `validation_error` | PO-C-08; PO-C-10 … PO-C-23 |
| `GET /purchase-orders/{poId}` | none (404 only) | PO-G-03 |
| `POST /purchase-orders/{poId}/submit` | `workflow_gate` | PO-S-03, PO-S-04 |

Out of scope for this area: `POST /purchase-orders/{poId}/receive` and rule `receive_quantity_limit`.
