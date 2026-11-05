# Documentation comparison questions

Sources inspected: `docs/API.md` and `GET http://localhost:8000/openapi.json` only. No other endpoints. No `src/`.

Every line below is marked **inspected only**.

## 1. In both documents

- inspected only — Base URL is `http://localhost:8000` (API.md Basics; OpenAPI `servers`).
- inspected only — No authentication (API.md Basics; OpenAPI `info.description`).
- inspected only — Data is in memory; restart or `POST /admin/reset` restores seed state (API.md Basics; OpenAPI `info.description`, `POST /admin/reset`).
- inspected only — Money is dollars rounded to cents (API.md Basics; OpenAPI money field descriptions, e.g. `VendorExposure.open_ap_liability`).
- inspected only — Rejected requests return JSON with `detail`; business/validation rejections also name `rule`; 404 has no `rule` (API.md Errors; OpenAPI `info.description`, schema `Error`).
- inspected only — Success statuses include 200 and 201; client/business failures use 400; missing records use 404 (API.md Errors; OpenAPI path responses).
- inspected only — The eleven named business rules plus `validation_error` appear as rejection `rule` values (API.md Business rules / Errors; OpenAPI schema `Error.rule`).
- inspected only — Purchase order statuses are `draft`, `submitted`, `closed` (API.md The purchase-to-pay flow; OpenAPI schema `PurchaseOrder.status`).
- inspected only — Invoice statuses are `received`, `matched`, `approved` (API.md The purchase-to-pay flow; OpenAPI schema `Invoice.status`).
- inspected only — `GET /health` returns `{"status":"ok"}` (API.md Endpoints / System; OpenAPI `/health`, schema `Health`).
- inspected only — `POST /admin/reset` restores seed vendors and catalog and returns `{"status":"reset"}` (API.md Endpoints / System; OpenAPI `/admin/reset`, schema `Reset`).
- inspected only — `GET /vendors` lists vendors; `POST /vendors` requires non-empty `name`, optional `active` defaulting to `true`, returns 201 (API.md Endpoints / Vendors; OpenAPI `/vendors`, schema `VendorCreate`).
- inspected only — `GET /vendors/{vendorId}/exposure` returns `vendor_id`, `open_ap_liability`, `approved_invoices`, and 404 for unknown vendor (API.md Endpoints / Vendors; OpenAPI `/vendors/{vendorId}/exposure`, schema `VendorExposure`).
- inspected only — Vendor exposure equals the sum of `total_amount` over that vendor’s approved invoices (`vendor_exposure_math`) (API.md Business rules; OpenAPI `/vendors/{vendorId}/exposure` description).
- inspected only — `GET /skus` lists the SKU catalog (API.md Endpoints / Catalog; OpenAPI `/skus`).
- inspected only — `POST /purchase-orders` creates a draft PO (201); vendor must exist (404) and be active (`inactive_vendor_gate`); each SKU once (API.md Endpoints / Purchase orders; OpenAPI `/purchase-orders`).
- inspected only — Line `quantity` must be greater than 0 and at most 10,000; `unit_price` from 0 to 100,000; same limits on deliveries and invoice lines (API.md Endpoints / Purchase orders; OpenAPI schemas `PoLineCreate`, `ReceiveRequest`, `InvoiceLine`).
- inspected only — `GET /purchase-orders/{poId}`, `POST .../submit`, `POST .../receive` exist with the documented workflow (`workflow_gate`, `receive_quantity_limit`; PO closes when fully received) (API.md Endpoints / Purchase orders; OpenAPI those paths).
- inspected only — `POST /invoices` creates an invoice against a submitted or closed PO; rules `overpayment_protection`, `duplicate_invoice_detection`, `invoice_line_validation`, `workflow_gate` apply (API.md Endpoints / Invoices; OpenAPI `/invoices`).
- inspected only — Invoice numbers are unique per vendor, compared case-insensitively and ignoring surrounding spaces (API.md Business rules; OpenAPI `/invoices` description).
- inspected only — `GET /invoices/{invoiceId}`, `POST .../match`, `POST .../approve` exist; match sets `partial_receipt` (`partial_receipt_flag`); approve requires match (`three_way_match_gate`), once only (`duplicate_approval`), and posts a balanced GL entry (`gl_balance`) (API.md Endpoints / Invoices + Business rules; OpenAPI those paths).
- inspected only — Approve posts debit `5000 Materials Expense` and credit `2000 Accounts Payable` (API.md approve example; OpenAPI `/invoices/{invoiceId}/approve` description).
- inspected only — Server-created IDs use `vnd-…`, `po-…`, `inv-…` style prefixes (API.md Basics; OpenAPI schema examples e.g. `Vendor.id`, `PurchaseOrder.id`, `Invoice.id`).
- inspected only — Reset restores two seed vendors (API.md Seed data; OpenAPI `POST /admin/reset` description).

## 2. In one document only

- inspected only — API.md only: `PORT=8001 npm start` changes the listen port (Basics).
- inspected only — API.md only: send `Content-Type: application/json` with every body (Basics).
- inspected only — API.md only: full seed vendor table (`vnd-001` Maple Ridge Supply active; `vnd-002` Old Quarry Materials inactive) (Seed data).
- inspected only — API.md only: full five-SKU catalog with descriptions and prices (Seed data).
- inspected only — API.md only: catalog is reference only; each PO carries its own line `unit_price` (Seed data).
- inspected only — API.md only: end-to-end purchase-to-pay narrative steps 1–8 and “status changes only move forward” (The purchase-to-pay flow).
- inspected only — API.md only: numbered business-rule table with the full promise wording for each of the 11 rules (Business rules).
- inspected only — API.md only: create-invoice response explicitly starts as `status: "received"`, `matched: false`, `partial_receipt: null` (Endpoints / Invoices).
- inspected only — API.md only: worked curl session and `npm run smoke` happy path (A full session with curl).
- inspected only — OpenAPI only: formal component schemas (`Health`, `Reset`, `Vendor`, `VendorCreate`, `VendorExposure`, `Sku`, `PoLine`, `PurchaseOrder`, `PoLineCreate`, `PurchaseOrderCreate`, `ReceiveRequest`, `InvoiceLine`, `Invoice`, `InvoiceCreate`, `MatchResult`, `GlLine`, `GlEntry`, `ApproveResult`, `Error`).
- inspected only — OpenAPI only: `line_items` / `items` arrays require `minItems: 1` (`PurchaseOrderCreate`, `ReceiveRequest`, `InvoiceCreate`).
- inspected only — OpenAPI only: `PoLineCreate.description` defaults to `""`.
- inspected only — OpenAPI only: invoice response includes `vendor_id` and `total_amount` as required fields (schema `Invoice`).
- inspected only — OpenAPI only: `partial_receipt` is typed as `boolean | null` with “null until the invoice is matched” (schema `Invoice`).
- inspected only — OpenAPI only: `MatchResult.matched` is enum `true` and `MatchResult.status` is enum `matched`; `ApproveResult.status` is enum `approved`.
- inspected only — OpenAPI only: API title `P2P Practice API` and version `1.0.0` (`info`).

## 3. Conflicts

None found

## 4. Not documented

- inspected only — Are fractional/decimal quantities allowed (for example `0.5` or `10.25`), or must `quantity` be a whole number? (assumed until answered)
- inspected only — What is the maximum length for vendor `name`, `invoice_number`, line `description`, and `sku`? (assumed until answered)
- inspected only — What happens on a second identical request (second `submit`, second `match` on an already-matched invoice, duplicate create with the same body)? (assumed until answered)
- inspected only — May a PO or invoice line use a SKU that is not in the catalog? (assumed until answered)
- inspected only — If invoice `unit_price` differs from the PO line `unit_price` but quantities and totals stay within received limits, do create and match succeed? (assumed until answered)
- inspected only — Is there a maximum number of line items on a PO, delivery, or invoice? (assumed until answered)
- inspected only — What response is returned when `Content-Type` is missing or is not `application/json`? (assumed until answered)
- inspected only — Can an inactive vendor be updated to active later, or is there no update path? (assumed until answered)
- inspected only — Does `overpayment_protection` compare against received quantities/values using invoice prices, PO prices, or both? (assumed until answered)
- inspected only — After a PO is `closed`, can further receive attempts occur, and what `rule`/status is returned? (assumed until answered)
