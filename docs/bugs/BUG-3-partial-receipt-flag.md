# Match returns partial_receipt false when a later PO line is not fully received

**Rule broken:** `partial_receipt_flag`

**Severity, with the money impact in one line:** Medium — control failure (reviewers can miss incomplete receipt before approval); not a direct overpay by itself while invoiced amounts stay within received.

**Basis:** executed

## Steps to reproduce

Two-line PO; receive the first line fully; leave the second at 0; invoice and match.

```bash
curl -s -X POST http://localhost:8000/admin/reset

curl -s -X POST http://localhost:8000/purchase-orders \
  -H 'Content-Type: application/json' \
  -d '{"vendor_id":"vnd-001","line_items":[{"sku":"LUM-2X4-8","quantity":10,"unit_price":4.75},{"sku":"CEM-30KG","quantity":4,"unit_price":11.9}]}'
# → po-b583f51e

curl -s -X POST http://localhost:8000/purchase-orders/po-b583f51e/submit

curl -s -X POST http://localhost:8000/purchase-orders/po-b583f51e/receive \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"sku":"LUM-2X4-8","quantity":10}]}'
# → LUM 10/10, CEM 0/4, fully_received: false

curl -s -X POST http://localhost:8000/invoices \
  -H 'Content-Type: application/json' \
  -d '{"po_id":"po-b583f51e","invoice_number":"BUG-PR-…","line_items":[{"sku":"LUM-2X4-8","quantity":10,"unit_price":4.75}]}'
# → note invoice id, e.g. inv-b6cea18a

curl -s -X POST http://localhost:8000/invoices/inv-b6cea18a/match
```

Same wrong flag when the first line is full and the second is only partially received (E2E-PR-05: LUM 10 + CEM 2 of 4 → `partial_receipt: false`).

## Expected

Quote from `docs/API.md` business rules:

> The match result sets `partial_receipt` to `true` when any line of the PO is not fully received.

Match should return `partial_receipt: true`.

## Actual

HTTP **200**:

```json
{
  "invoice_id": "inv-b6cea18a",
  "po_id": "po-b583f51e",
  "status": "matched",
  "matched": true,
  "partial_receipt": false,
  "ordered_value": 95.1,
  "received_value": 47.5,
  "invoice_total": 47.5,
  "message": "3-way match passed."
}
```

## What this proves

When an earlier PO line is fully received and a later line is not, match still reports `partial_receipt: false`, so the documented “any line” flag is wrong for that shape.

## What this does not prove

It does not prove every partial-receipt shape is wrong: receiving only a partial amount on the first line (INV-M-02: LUM 5 of 10, CEM 0) still returns `partial_receipt: true`. Match and approve of the invoiced amount still succeed.

## Open question

Is the flag computed only from the first PO line (or only from lines already touched by receive), instead of every line on the PO?
