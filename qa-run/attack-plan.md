# Adversary attack plan

Base URL: `http://localhost:8000`. Each attack builds its own fresh vendor and/or order (reset between groups when needed). Outcomes go to `attacks.jsonl`.

## Challenge-required (first four)

| # | Attack | Rule |
| --- | --- | --- |
| A1 | Approve an unmatched invoice (create invoice, skip match, approve) | `three_way_match_gate` |
| A2 | Receive more than ordered (qty ordered 10, receive 11) | `receive_quantity_limit` |
| A3 | Invoice more than the received value (receive 5 of 10, invoice 10) | `overpayment_protection` |
| A4 | Order from inactive vendor `vnd-002` | `inactive_vendor_gate` |

## Edge cases by rule

### `receive_quantity_limit`
| # | Attack |
| --- | --- |
| A5 | One unit over: order 10, receive 11 |
| A6 | Cumulative over: order 10, receive 6 then receive 5 |

### `overpayment_protection`
| # | Attack |
| --- | --- |
| A7 | One cent over received value |
| A8 | Small percentage over received value (~1%) |
| A9 | Two invoices on one order that together exceed received value |
| A10 | Invoice qty over received qty on a line (same unit price) |

### Validation / money edges (may map to `validation_error` or rules)
| # | Attack | Expected rule / note |
| --- | --- | --- |
| A11 | Zero quantity on PO line | validation / undocumented if not named |
| A12 | Negative quantity on receive | validation / undocumented |
| A13 | Negative unit_price on invoice | validation / undocumented |
| A14 | Prices `0.1` and `0.2` float rounding on invoice vs receive | `overpayment_protection` / `gl_balance` / undocumented |

### `duplicate_invoice_detection`
| # | Attack |
| --- | --- |
| A15 | Same number differing only by case (`INV-DUP` then `inv-dup`) |
| A16 | Same number with surrounding spaces (` INV-DUP2 `) |

### `partial_receipt_flag`
| # | Attack |
| --- | --- |
| A17 | Two-line PO; receive only first line fully; match — expect `partial_receipt: true` |
| A18 | Two-line PO; receive only last line fully; match — expect `partial_receipt: true` |

### `workflow_gate`
| # | Attack |
| --- | --- |
| A19 | Receive on draft (before submit) |
| A20 | Submit already-submitted PO |
| A21 | Invoice a draft PO |
| A22 | Match an already-approved invoice |

### `duplicate_approval`
| # | Attack |
| --- | --- |
| A23 | Approve a matched invoice twice |

### `invoice_line_validation`
| # | Attack |
| --- | --- |
| A24 | Invoice SKU not on the PO |
| A25 | Duplicate SKU on invoice lines |

### `three_way_match_gate` (extra)
| # | Attack |
| --- | --- |
| A26 | Approve invoice still in `received` status (unmatched) — same as A1 setup |

### `gl_balance`
| # | Attack |
| --- | --- |
| A27 | Happy approve then check `gl_entry.balanced` and debit==credit (probe, not break) |

### `vendor_exposure_math`
| # | Attack |
| --- | --- |
| A28 | Approve two invoices for same vendor; exposure must equal sum of totals |

### Fresh vendor path
| # | Attack |
| --- | --- |
| A29 | Create inactive vendor via POST, try to create PO | `inactive_vendor_gate` |
