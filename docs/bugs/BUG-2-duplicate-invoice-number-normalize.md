# Case and surrounding spaces do not collide on invoice_number

**Rule broken:** `duplicate_invoice_detection`

**Severity, with the money impact in one line:** High — duplicate AP of the full invoice total (e.g. $23.75 paid twice for case or space variants of the same number).

**Basis:** executed

## Steps to reproduce

Fresh data after reset. Same vendor, same PO capacity for two invoices.

### Case fold (`INV-DUP-…` then `inv-dup-…`)

```bash
curl -s -X POST http://localhost:8000/admin/reset

curl -s -X POST http://localhost:8000/purchase-orders \
  -H 'Content-Type: application/json' \
  -d '{"vendor_id":"vnd-001","line_items":[{"sku":"LUM-2X4-8","quantity":10,"unit_price":4.75}]}'
# → po-5d71d91e

curl -s -X POST http://localhost:8000/purchase-orders/po-5d71d91e/submit
curl -s -X POST http://localhost:8000/purchase-orders/po-5d71d91e/receive \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"sku":"LUM-2X4-8","quantity":10}]}'

curl -s -X POST http://localhost:8000/invoices \
  -H 'Content-Type: application/json' \
  -d '{"po_id":"po-5d71d91e","invoice_number":"INV-DUP-1793929127","line_items":[{"sku":"LUM-2X4-8","quantity":5,"unit_price":4.75}]}'
# → HTTP 201

curl -s -X POST http://localhost:8000/invoices \
  -H 'Content-Type: application/json' \
  -d '{"po_id":"po-5d71d91e","invoice_number":"inv-dup-1793929127","line_items":[{"sku":"LUM-2X4-8","quantity":5,"unit_price":4.75}]}'
# → HTTP 201 (should be 400)
```

### Surrounding spaces (`INV-SPC-…` then ` INV-SPC-… `)

```bash
curl -s -X POST http://localhost:8000/invoices \
  -H 'Content-Type: application/json' \
  -d '{"po_id":"po-625a4169","invoice_number":"INV-SPC-1793929169","line_items":[{"sku":"LUM-2X4-8","quantity":5,"unit_price":4.75}]}'
# → HTTP 201

curl -s -X POST http://localhost:8000/invoices \
  -H 'Content-Type: application/json' \
  -d '{"po_id":"po-625a4169","invoice_number":" INV-SPC-1793929169 ","line_items":[{"sku":"LUM-2X4-8","quantity":5,"unit_price":4.75}]}'
# → HTTP 201 (should be 400)
```

## Expected

Quote from `docs/API.md` business rules:

> A vendor cannot submit the same invoice number twice. Numbers are compared ignoring upper or lower case and surrounding spaces, so `INV-7`, `inv-7` and ` INV-7 ` are the same number.

Second create should return **400** with `rule: "duplicate_invoice_detection"`.

## Actual

Second create returns HTTP **201** (case variant):

```json
{
  "id": "inv-bf44520d",
  "po_id": "po-5d71d91e",
  "vendor_id": "vnd-001",
  "invoice_number": "inv-dup-1793929127",
  "status": "received",
  "line_items": [{"sku": "LUM-2X4-8", "quantity": 5, "unit_price": 4.75}],
  "total_amount": 23.75,
  "matched": false,
  "partial_receipt": null
}
```

Space variant likewise **201** with `invoice_number: " INV-SPC-1793929169 "` and `total_amount: 23.75`.

Exact same string twice is still rejected (INV-C-13); only normalization is broken.

## What this proves

Duplicate detection does not normalize case or trim surrounding spaces, so a vendor can create two invoices that the docs treat as one number.

## What this does not prove

It does not prove exact-string duplicates are accepted. It does not prove both invoices can be matched and approved end-to-end in one session (received-quantity caps may block a second full invoice on the same PO).

## Open question

Is uniqueness intended per vendor globally (across POs), and if so does a case/space variant on a different PO of the same vendor also collide?
