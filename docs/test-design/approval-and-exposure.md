# Test design: approval-and-exposure

Area: `POST /invoices/{invoiceId}/approve`, `GET /vendors/{vendorId}/exposure`.

Sources: `docs/API.md` (Basics, Errors, The purchase-to-pay flow, Business rules, Endpoints / Vendors, Endpoints / Invoices, A full session with curl), OpenAPI `/invoices/{invoiceId}/approve`, `/vendors/{vendorId}/exposure`, schemas `ApproveResult`, `GlEntry`, `GlLine`, `VendorExposure`, `Invoice`, `Error`, and `docs/QUESTIONS.md` §4.

Prerequisite for every case that depends on known seed state: `POST /admin/reset` first.

Setup shorthand used below (unless a row says otherwise): create a draft PO with `vnd-001` and the listed lines → `POST .../submit` → receive as stated → `POST /invoices` with a unique `invoice_number` → `POST .../match` → then the approve or exposure call under test.

No request body is documented for approve (OpenAPI: path param only). Cases send an empty POST unless noted.

---

## POST /invoices/{invoiceId}/approve

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| APP-01 | positive | Setup: one line LUM qty 10 @ 4.75, fully received, invoiced full, matched. `POST /invoices/{invoiceId}/approve` | 200 | `ApproveResult`: `invoice_id` equals path id; `status:"approved"`; `gl_entry.debits` = `[{account:"5000 Materials Expense", amount:47.5}]`; `gl_entry.credits` = `[{account:"2000 Accounts Payable", amount:47.5}]`; `gl_entry.balanced:true`; `vendor_exposure:47.5` | API.md Endpoints / Invoices approve example + curl; OpenAPI `ApproveResult` / description (debit 5000 / credit 2000); Business rules #7 `gl_balance`, #11 | happy path / documented example |
| APP-02 | positive | Setup: two lines (LUM 10 @ 4.75, CEM 4 @ 11.9), fully received (PO closed), invoiced both, matched. Approve | 200 | `status:"approved"`; debit and credit amounts `95.1`; `balanced:true`; `vendor_exposure:95.1` | API.md approve example body (`95.1`); OpenAPI | documented option / multi-line total |
| APP-03 | positive | Setup: PO qty 10, receive 5 only; invoice qty 5 @ 4.75; match (`partial_receipt:true`); approve | 200 | `status:"approved"`; debit/credit `23.75`; `balanced:true`; `vendor_exposure:23.75` | API.md #4 three_way_match_gate (match passed); #5 flag does not block approve; OpenAPI 400 only “Not matched, or already approved” | state / matched with partial receipt |
| APP-04 | positive | Setup: fully received; invoice `quantity:1`, `unit_price:0`; match; approve | 200 | `status:"approved"`; debit/credit `amount:0`; `balanced:true`; `vendor_exposure:0` (if this is the vendor’s only approved invoice) | OpenAPI `unit_price` `minimum:0`; API.md money / `gl_balance` | boundary (zero amount) |
| APP-05 | positive | Setup: approve first matched invoice totaling 47.5 (as APP-01). Second PO/invoice for same vendor totaling 23.75, matched, then approve the second | 200 | Second approve: `vendor_exposure:71.25` (= 47.5 + 23.75); GL amounts equal second invoice total; `balanced:true` | API.md Business rules #11; OpenAPI approve “includes the vendor's new exposure” | state / cumulative exposure |
| APP-06 | positive | After APP-01 succeed, `GET /invoices/{invoiceId}` | 200 | Invoice `status:"approved"`; `matched:true`; `total_amount` unchanged (e.g. 47.5) | API.md flow received → matched → approved; OpenAPI `Invoice.status` enum | state / status moved forward |
| APP-07 | error | `POST /invoices/inv-does-not-exist/approve` | 404 | `detail` present; `rule` absent | API.md Errors; OpenAPI `/approve` 404 “Invoice not found” | unknown id |
| APP-08 | error | Setup: create invoice only (status `received`, do **not** match). `POST .../approve` | 400 | `detail` present; `rule:"three_way_match_gate"` | API.md Business rules #4; OpenAPI description + 400 “Not matched…” | state / wrong order |
| APP-09 | error | Setup: match → approve successfully → `POST .../approve` again on the same id | 400 | Second call: `detail` present; `rule:"duplicate_approval"` | API.md Business rules #9; OpenAPI “approved once” | state / done twice |

`gl_balance` is asserted on success (APP-01 … APP-05): debit total equals credit total and `balanced:true`. It is not exercised as a client-triggered 400. `vendor_exposure` on the approve response is checked against the invoice total(s); full `vendor_exposure_math` list/sum checks live under exposure below.

---

## GET /vendors/{vendorId}/exposure

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| EXP-01 | positive | After reset, `GET /vendors/vnd-001/exposure` (no approvals yet) | 200 | `VendorExposure`: `vendor_id:"vnd-001"`; `open_ap_liability:0`; `approved_invoices:[]` | API.md Business rules #11 (sum over approved); OpenAPI `VendorExposure` | happy path / empty sum |
| EXP-02 | positive | After reset, `GET /vendors/vnd-002/exposure` (inactive seed, no approvals) | 200 | `vendor_id:"vnd-002"`; `open_ap_liability:0`; `approved_invoices:[]` | API.md Endpoints / Vendors (404 only for unknown); Seed data `vnd-002` inactive | equivalence / inactive but known vendor |
| EXP-03 | positive | `POST /vendors` with a new name → `GET /vendors/{newId}/exposure` | 200 | `vendor_id` equals new id; `open_ap_liability:0`; `approved_invoices:[]` | API.md Endpoints / Vendors; OpenAPI | state / non-seed vendor |
| EXP-04 | positive | Setup: approve one matched invoice totaling 47.5 for `vnd-001`. `GET /vendors/vnd-001/exposure` | 200 | `vendor_id:"vnd-001"`; `open_ap_liability:47.5`; `approved_invoices` is an array of length 1 containing that `invoice_id` | API.md exposure example shape + #11; OpenAPI; curl session | happy path / single approval |
| EXP-05 | positive | Setup: approve two invoices for `vnd-001` with totals 47.5 and 23.75. `GET .../exposure` | 200 | `open_ap_liability:71.25`; `approved_invoices` contains both invoice ids (length 2) | API.md Business rules #11; OpenAPI description | equivalence / sum of multiple |
| EXP-06 | positive | Setup: create + match an invoice for `vnd-001` but do **not** approve. `GET /vendors/vnd-001/exposure` | 200 | `open_ap_liability:0`; `approved_invoices:[]` (matched-only does not count) | API.md #11 “approved invoices” only; flow step 8 after approve | state / not yet approved |
| EXP-07 | positive | Setup: approve invoice A for `vnd-001`; create a second active vendor, run full flow and approve invoice B there. `GET` each vendor’s exposure | 200 | Vendor A liability equals A’s approved total(s) only; vendor B equals B’s only; each `approved_invoices` lists only that vendor’s ids | API.md #11 per-vendor sum | equivalence / isolation across vendors |
| EXP-08 | positive | After a successful approve (e.g. APP-01), compare approve body’s `vendor_exposure` to `GET /vendors/{vendorId}/exposure` → `open_ap_liability` | 200 | Both numbers equal (same cents) | API.md approve “includes the vendor's new exposure” + #11; OpenAPI money “rounded to cents” | state / approve vs GET agree |
| EXP-09 | error | `GET /vendors/vnd-does-not-exist/exposure` | 404 | `detail` present; `rule` absent | API.md Errors + Endpoints / Vendors; OpenAPI 404 “Vendor not found” | unknown id |

No query params or request body documented for exposure. No business-rule **rejection** on GET; `vendor_exposure_math` is asserted via expected liability and id list on success.

No `QUESTIONS.md` §4 item is specific to approve or exposure (second approve is documented as `duplicate_approval`). No “assumed — ask” rows for this area.

---

## Coverage notes

| Endpoint | Business rules that apply | Covered by |
| --- | --- | --- |
| `POST /invoices/{invoiceId}/approve` | `three_way_match_gate` | APP-08 |
| | `duplicate_approval` | APP-09 |
| | `gl_balance` (success assertion) | APP-01 … APP-05 |
| | `vendor_exposure` field / #11 on response | APP-01, APP-02, APP-05 |
| `GET /vendors/{vendorId}/exposure` | `vendor_exposure_math` | EXP-01, EXP-04, EXP-05, EXP-06, EXP-07, EXP-08 |

Out of scope for this area: create/match invoice validation, PO receive limits, and listing/creating vendors (covered in other designs). Approve is used as setup for exposure rows that need an approved invoice.
