# Invoice accepted when unit_price puts total one cent over received value

**Rule broken:** `overpayment_protection`

**Severity, with the money impact in one line:** High — AP can be overstated by at least $0.01 per invoice via unit-price padding (quantity overages are blocked).

**Basis:** executed

## Steps to reproduce

Fresh data after `POST /admin/reset`. Receive value is $10.00; invoice at $10.01 is accepted.

```bash
curl -s -X POST http://localhost:8000/admin/reset

curl -s -X POST http://localhost:8000/purchase-orders \
  -H 'Content-Type: application/json' \
  -d '{"vendor_id":"vnd-001","line_items":[{"sku":"LUM-2X4-8","quantity":1,"unit_price":10.00}]}'
# → note po_id, e.g. po-fc985d59

curl -s -X POST http://localhost:8000/purchase-orders/po-fc985d59/submit

curl -s -X POST http://localhost:8000/purchase-orders/po-fc985d59/receive \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"sku":"LUM-2X4-8","quantity":1}]}'
# → received_value: 10

curl -s -X POST http://localhost:8000/invoices \
  -H 'Content-Type: application/json' \
  -d '{"po_id":"po-fc985d59","invoice_number":"BUG-OP-1793929127","line_items":[{"sku":"LUM-2X4-8","quantity":1,"unit_price":10.01}]}'
```

Same failure with the INV-C-11 shape (qty 10 @ 4.75 received, invoice @ 4.76):

```bash
curl -s -X POST http://localhost:8000/invoices \
  -H 'Content-Type: application/json' \
  -d '{"po_id":"<fully-received-lum-po>","invoice_number":"BUG-OP2-…","line_items":[{"sku":"LUM-2X4-8","quantity":10,"unit_price":4.76}]}'
```

## Expected

Quote from `docs/API.md` business rules:

> Everything invoiced on a PO never exceeds what was received: not per line quantity, and not in total value. There is no tolerance.

Create should return **400** with `rule: "overpayment_protection"`.

## Actual

HTTP **201**:

```json
{
  "id": "inv-62175448",
  "po_id": "po-fc985d59",
  "vendor_id": "vnd-001",
  "invoice_number": "BUG-OP-1793929127",
  "status": "received",
  "line_items": [{"sku": "LUM-2X4-8", "quantity": 1, "unit_price": 10.01}],
  "total_amount": 10.01,
  "matched": false,
  "partial_receipt": null
}
```

## What this proves

`overpayment_protection` does not reject a one-cent unit-price overage against received value; the invoice is created and can proceed toward match/approve.

## What this does not prove

It does not prove quantity-based over-invoicing is allowed (that path still returns 400). It does not prove match or approve will post the padded amount without further checks — only that create accepts it.

## Open question

Does `overpayment_protection` compare received value using PO line prices only, invoice prices only, or a mix? (Also listed in `docs/QUESTIONS.md`.)
