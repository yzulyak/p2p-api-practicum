import { test, expect, type APIRequestContext } from '@playwright/test';
import { expectSchema } from './helpers/schema';

type PoLine = {
  sku: string;
  description?: string;
  quantity: number;
  unit_price: number;
  received_quantity: number;
};

type PurchaseOrder = {
  id: string;
  vendor_id: string;
  status: string;
  line_items: PoLine[];
  ordered_value: number;
  received_value: number;
  fully_received: boolean;
};

type Invoice = {
  id: string;
  po_id: string;
  vendor_id: string;
  invoice_number: string;
  status: string;
  line_items: Array<{ sku: string; quantity: number; unit_price: number }>;
  total_amount: number;
  matched: boolean;
  partial_receipt: boolean | null;
};

const LUM_LINE = {
  sku: 'LUM-2X4-8',
  quantity: 10,
  unit_price: 4.75,
} as const;

const CEM_LINE = {
  sku: 'CEM-30KG',
  quantity: 4,
  unit_price: 11.9,
} as const;

function uniqueInvoiceNumber(prefix = 'INV'): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

async function createDraftPo(
  request: APIRequestContext,
  lineItems: Array<Record<string, unknown>> = [{ ...LUM_LINE }],
): Promise<PurchaseOrder> {
  const response = await request.post('/purchase-orders', {
    data: { vendor_id: 'vnd-001', line_items: lineItems },
  });
  expect(response.status()).toBe(201);
  const po = await response.json();
  await expectSchema(request, po, 'PurchaseOrder');
  return po as PurchaseOrder;
}

async function createSubmittedPo(
  request: APIRequestContext,
  lineItems: Array<Record<string, unknown>> = [{ ...LUM_LINE }],
): Promise<PurchaseOrder> {
  const draft = await createDraftPo(request, lineItems);
  const response = await request.post(`/purchase-orders/${draft.id}/submit`);
  expect(response.status()).toBe(200);
  const po = await response.json();
  await expectSchema(request, po, 'PurchaseOrder');
  expect(po.status).toBe('submitted');
  return po as PurchaseOrder;
}

async function receivePo(
  request: APIRequestContext,
  poId: string,
  items: Array<{ sku: string; quantity: number }>,
): Promise<PurchaseOrder> {
  const response = await request.post(`/purchase-orders/${poId}/receive`, {
    data: { items },
  });
  expect(response.status()).toBe(200);
  const po = await response.json();
  await expectSchema(request, po, 'PurchaseOrder');
  return po as PurchaseOrder;
}

async function createFullyReceivedPo(
  request: APIRequestContext,
  lineItems: Array<Record<string, unknown>> = [{ ...LUM_LINE }],
): Promise<PurchaseOrder> {
  const po = await createSubmittedPo(request, lineItems);
  const receiveItems = lineItems.map((line) => ({
    sku: String(line.sku),
    quantity: Number(line.quantity),
  }));
  return receivePo(request, po.id, receiveItems);
}

async function createInvoice(
  request: APIRequestContext,
  data: Record<string, unknown>,
): Promise<{ response: Awaited<ReturnType<APIRequestContext['post']>>; body: Invoice }> {
  const response = await request.post('/invoices', { data });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as Invoice;
  await expectSchema(request, body, 'Invoice');
  return { response, body };
}

// --- POST /invoices ---

test('INV-C-01 POST /invoices documented single-line fully received', { tag: '@api' }, async ({
  request,
}) => {
  // executed — fully received LUM PO → invoice at PO prices → 201 received
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);
  const invoiceNumber = uniqueInvoiceNumber('INV-1001');

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      invoice_number: invoiceNumber,
      line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
    },
  });
  expect(response.status()).toBe(201);

  const body = (await response.json()) as Invoice;
  await expectSchema(request, body, 'Invoice');
  expect(body.id.startsWith('inv-')).toBe(true);
  expect(body.po_id).toBe(po.id);
  expect(body.vendor_id).toBe('vnd-001');
  expect(body.invoice_number).toBe(invoiceNumber);
  expect(body.status).toBe('received');
  expect(body.matched).toBe(false);
  expect(body.partial_receipt).toBeNull();
  expect(body.line_items).toHaveLength(1);
  expect(body.line_items[0]).toMatchObject({
    sku: 'LUM-2X4-8',
    quantity: 10,
    unit_price: 4.75,
  });
  expect(body.total_amount).toBe(47.5);
});

test('INV-C-02 POST /invoices multi-line closed PO', { tag: '@api' }, async ({ request }) => {
  // executed — closed multi-line PO → invoice both lines → 201
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }, { ...CEM_LINE }]);
  expect(po.status).toBe('closed');

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      invoice_number: uniqueInvoiceNumber(),
      line_items: [
        { sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 },
        { sku: 'CEM-30KG', quantity: 4, unit_price: 11.9 },
      ],
    },
  });
  expect(response.status()).toBe(201);

  const body = (await response.json()) as Invoice;
  await expectSchema(request, body, 'Invoice');
  expect(body.status).toBe('received');
  expect(body.matched).toBe(false);
  expect(body.partial_receipt).toBeNull();
  expect(body.line_items).toHaveLength(2);
  expect(body.total_amount).toBe(95.1);
  expect(body.vendor_id).toBe('vnd-001');
});

test('INV-C-03 POST /invoices qty less than received', { tag: '@api' }, async ({ request }) => {
  // executed — invoice qty under received → 201
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      invoice_number: uniqueInvoiceNumber(),
      line_items: [{ sku: 'LUM-2X4-8', quantity: 5, unit_price: 4.75 }],
    },
  });
  expect(response.status()).toBe(201);

  const body = (await response.json()) as Invoice;
  await expectSchema(request, body, 'Invoice');
  expect(body.status).toBe('received');
  expect(body.total_amount).toBe(23.75);
  expect(body.matched).toBe(false);
  expect(body.partial_receipt).toBeNull();
});

test('INV-C-04 POST /invoices quantity 1 smallest valid', { tag: '@api' }, async ({ request }) => {
  // executed — invoice quantity:1 boundary
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      invoice_number: uniqueInvoiceNumber(),
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
    },
  });
  expect(response.status()).toBe(201);

  const body = (await response.json()) as Invoice;
  await expectSchema(request, body, 'Invoice');
  expect(body.line_items[0].quantity).toBe(1);
  expect(body.total_amount).toBe(4.75);
  expect(body.status).toBe('received');
});

test('INV-C-05 POST /invoices unit_price 0 accepted', { tag: '@api' }, async ({ request }) => {
  // executed — invoice unit_price:0 minimum boundary
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      invoice_number: uniqueInvoiceNumber(),
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 0 }],
    },
  });
  expect(response.status()).toBe(201);

  const body = (await response.json()) as Invoice;
  await expectSchema(request, body, 'Invoice');
  expect(body.line_items[0].unit_price).toBe(0);
  expect(body.total_amount).toBe(0);
  expect(body.status).toBe('received');
});

test('INV-C-06 POST /invoices quantity at upper limit 10000', { tag: '@api' }, async ({
  request,
}) => {
  // executed — invoice quantity:10000 at schema max
  const po = await createFullyReceivedPo(request, [
    { sku: 'LUM-2X4-8', quantity: 10000, unit_price: 1 },
  ]);

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      invoice_number: uniqueInvoiceNumber(),
      line_items: [{ sku: 'LUM-2X4-8', quantity: 10000, unit_price: 1 }],
    },
  });
  expect(response.status()).toBe(201);

  const body = (await response.json()) as Invoice;
  await expectSchema(request, body, 'Invoice');
  expect(body.line_items[0].quantity).toBe(10000);
  expect(body.total_amount).toBe(10000);
  expect(body.status).toBe('received');
});

test('INV-C-07 POST /invoices on submitted not fully received PO', { tag: '@api' }, async ({
  request,
}) => {
  // executed — invoice allowed on submitted PO within received
  const po = await createSubmittedPo(request, [{ ...LUM_LINE }]);
  const partial = await receivePo(request, po.id, [{ sku: 'LUM-2X4-8', quantity: 5 }]);
  expect(partial.status).toBe('submitted');

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      invoice_number: uniqueInvoiceNumber(),
      line_items: [{ sku: 'LUM-2X4-8', quantity: 5, unit_price: 4.75 }],
    },
  });
  expect(response.status()).toBe(201);

  const body = (await response.json()) as Invoice;
  await expectSchema(request, body, 'Invoice');
  expect(body.status).toBe('received');
});

test('INV-C-08 POST /invoices unknown po_id returns 404', { tag: '@api' }, async ({ request }) => {
  // executed — unknown po_id → 404, no rule
  const response = await request.post('/invoices', {
    data: {
      po_id: 'po-does-not-exist',
      invoice_number: uniqueInvoiceNumber(),
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
    },
  });
  expect(response.status()).toBe(404);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBeUndefined();
});

test('INV-C-09 POST /invoices on draft PO returns workflow_gate', { tag: '@api' }, async ({
  request,
}) => {
  // executed — invoice draft PO → 400 workflow_gate
  const draft = await createDraftPo(request, [{ ...LUM_LINE }]);

  const response = await request.post('/invoices', {
    data: {
      po_id: draft.id,
      invoice_number: uniqueInvoiceNumber(),
      line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
    },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('workflow_gate');
});

test('INV-C-10 POST /invoices qty one over received returns overpayment_protection', { tag: '@api' }, async ({
  request,
}) => {
  // executed — quantity 11 vs received 10 → overpayment_protection
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      invoice_number: uniqueInvoiceNumber(),
      line_items: [{ sku: 'LUM-2X4-8', quantity: 11, unit_price: 4.75 }],
    },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('overpayment_protection');
});

test('INV-C-11 POST /invoices unit_price one cent over returns overpayment_protection', { tag: '@api' }, async ({
  request,
}) => {
  // executed — total one cent over received value → overpayment_protection
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      invoice_number: uniqueInvoiceNumber(),
      line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.76 }],
    },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('overpayment_protection');
});

test('INV-C-12 POST /invoices qty over partial receive returns overpayment_protection', { tag: '@api' }, async ({
  request,
}) => {
  // executed — invoice 6 vs received 5 → overpayment_protection
  const po = await createSubmittedPo(request, [{ ...LUM_LINE }]);
  await receivePo(request, po.id, [{ sku: 'LUM-2X4-8', quantity: 5 }]);

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      invoice_number: uniqueInvoiceNumber(),
      line_items: [{ sku: 'LUM-2X4-8', quantity: 6, unit_price: 4.75 }],
    },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('overpayment_protection');
});

test('INV-C-13 POST /invoices duplicate invoice_number returns duplicate_invoice_detection', { tag: '@api' }, async ({
  request,
}) => {
  // executed — second create same invoice_number → duplicate_invoice_detection
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);
  const invoiceNumber = uniqueInvoiceNumber('INV-DUP');

  const first = await createInvoice(request, {
    po_id: po.id,
    invoice_number: invoiceNumber,
    line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
  });
  expect(first.body.invoice_number).toBe(invoiceNumber);

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      invoice_number: invoiceNumber,
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
    },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('duplicate_invoice_detection');
});

test('INV-C-14 POST /invoices case-insensitive duplicate invoice_number', { tag: '@api' }, async ({
  request,
}) => {
  // executed — INV-7 then inv-7 → duplicate_invoice_detection
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);
  const base = `INV-7-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

  await createInvoice(request, {
    po_id: po.id,
    invoice_number: base,
    line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
  });

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      invoice_number: base.toLowerCase(),
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
    },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('duplicate_invoice_detection');
});

test('INV-C-15 POST /invoices trimmed-space duplicate invoice_number', { tag: '@api' }, async ({
  request,
}) => {
  // executed — INV-7 then " INV-7 " → duplicate_invoice_detection
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);
  const base = `INV-7-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

  await createInvoice(request, {
    po_id: po.id,
    invoice_number: base,
    line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
  });

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      invoice_number: ` ${base} `,
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
    },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('duplicate_invoice_detection');
});

test('INV-C-16 POST /invoices SKU not on PO returns invoice_line_validation', { tag: '@api' }, async ({
  request,
}) => {
  // executed — CEM on LUM-only PO → invoice_line_validation
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      invoice_number: uniqueInvoiceNumber(),
      line_items: [{ sku: 'CEM-30KG', quantity: 1, unit_price: 11.9 }],
    },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('invoice_line_validation');
});

test('INV-C-17 POST /invoices duplicate SKU returns invoice_line_validation', { tag: '@api' }, async ({
  request,
}) => {
  // executed — two LUM lines on invoice → invoice_line_validation
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }, { ...CEM_LINE }]);

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      invoice_number: uniqueInvoiceNumber(),
      line_items: [
        { sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 },
        { sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 },
      ],
    },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('invoice_line_validation');
});

test('INV-C-18 POST /invoices empty body returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — {} missing required fields → validation_error
  const response = await request.post('/invoices', { data: {} });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('INV-C-19 POST /invoices missing po_id returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — missing po_id only → validation_error
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);
  expect(po.id).toBeTruthy();

  const response = await request.post('/invoices', {
    data: {
      invoice_number: uniqueInvoiceNumber(),
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
    },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('INV-C-20 POST /invoices empty po_id returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — po_id:"" → validation_error
  const response = await request.post('/invoices', {
    data: {
      po_id: '',
      invoice_number: uniqueInvoiceNumber(),
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
    },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('INV-C-21 POST /invoices missing invoice_number returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — missing invoice_number → validation_error
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
    },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('INV-C-22 POST /invoices empty invoice_number returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — invoice_number:"" → validation_error
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      invoice_number: '',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
    },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('INV-C-23 POST /invoices empty line_items returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — line_items:[] → validation_error
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      invoice_number: uniqueInvoiceNumber(),
      line_items: [],
    },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('INV-C-24 POST /invoices line missing sku returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — line missing sku → validation_error
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      invoice_number: uniqueInvoiceNumber(),
      line_items: [{ quantity: 1, unit_price: 4.75 }],
    },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('INV-C-25 POST /invoices empty line sku returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — sku:"" → validation_error
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      invoice_number: uniqueInvoiceNumber(),
      line_items: [{ sku: '', quantity: 1, unit_price: 4.75 }],
    },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('INV-C-26 POST /invoices line missing quantity returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — line missing quantity → validation_error
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      invoice_number: uniqueInvoiceNumber(),
      line_items: [{ sku: 'LUM-2X4-8', unit_price: 4.75 }],
    },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('INV-C-27 POST /invoices line missing unit_price returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — line missing unit_price → validation_error
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      invoice_number: uniqueInvoiceNumber(),
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1 }],
    },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('INV-C-28 POST /invoices quantity 0 returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — quantity:0 → validation_error
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      invoice_number: uniqueInvoiceNumber(),
      line_items: [{ sku: 'LUM-2X4-8', quantity: 0, unit_price: 4.75 }],
    },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('INV-C-29 POST /invoices quantity -1 returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — quantity:-1 → validation_error
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      invoice_number: uniqueInvoiceNumber(),
      line_items: [{ sku: 'LUM-2X4-8', quantity: -1, unit_price: 4.75 }],
    },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('INV-C-30 POST /invoices quantity 10001 returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — quantity:10001 → validation_error
  const po = await createFullyReceivedPo(request, [
    { sku: 'LUM-2X4-8', quantity: 10000, unit_price: 1 },
  ]);

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      invoice_number: uniqueInvoiceNumber(),
      line_items: [{ sku: 'LUM-2X4-8', quantity: 10001, unit_price: 1 }],
    },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('INV-C-31 POST /invoices unit_price -0.01 returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — unit_price:-0.01 → validation_error
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      invoice_number: uniqueInvoiceNumber(),
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: -0.01 }],
    },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('INV-C-32 POST /invoices unit_price 100000.01 returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — unit_price:100000.01 → validation_error
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      invoice_number: uniqueInvoiceNumber(),
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 100000.01 }],
    },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('INV-C-33 POST /invoices quantity as string returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — quantity:"10" wrong type → validation_error
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);

  const response = await request.post('/invoices', {
    data: {
      po_id: po.id,
      invoice_number: uniqueInvoiceNumber(),
      line_items: [{ sku: 'LUM-2X4-8', quantity: '10', unit_price: 4.75 }],
    },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

// --- GET /invoices/{invoiceId} ---

test('INV-G-01 GET /invoices/{invoiceId} returns created invoice', { tag: '@api' }, async ({
  request,
}) => {
  // executed — GET after create matches create shape
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);
  const invoiceNumber = uniqueInvoiceNumber('INV-1001');
  const { body: created } = await createInvoice(request, {
    po_id: po.id,
    invoice_number: invoiceNumber,
    line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });

  const response = await request.get(`/invoices/${created.id}`);
  expect(response.status()).toBe(200);

  const body = (await response.json()) as Invoice;
  await expectSchema(request, body, 'Invoice');
  expect(body.status).toBe('received');
  expect(body.matched).toBe(false);
  expect(body.partial_receipt).toBeNull();
  expect(body.po_id).toBe(po.id);
  expect(body.vendor_id).toBe('vnd-001');
  expect(body.invoice_number).toBe(invoiceNumber);
  expect(body.line_items).toEqual(created.line_items);
  expect(body.total_amount).toBe(47.5);
});

test('INV-G-02 GET /invoices/{invoiceId} after match shows matched', { tag: '@api' }, async ({
  request,
}) => {
  // executed — GET after match → matched status and partial_receipt boolean
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);
  const { body: created } = await createInvoice(request, {
    po_id: po.id,
    invoice_number: uniqueInvoiceNumber(),
    line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });

  const matchResponse = await request.post(`/invoices/${created.id}/match`);
  expect(matchResponse.status()).toBe(200);
  await expectSchema(request, await matchResponse.json(), 'MatchResult');

  const response = await request.get(`/invoices/${created.id}`);
  expect(response.status()).toBe(200);

  const body = (await response.json()) as Invoice;
  await expectSchema(request, body, 'Invoice');
  expect(body.status).toBe('matched');
  expect(body.matched).toBe(true);
  expect(typeof body.partial_receipt).toBe('boolean');
  expect(body.partial_receipt).not.toBeNull();
  expect(body.id).toBe(created.id);
  expect(body.total_amount).toBe(created.total_amount);
});

test('INV-G-03 GET /invoices/{invoiceId} unknown id returns 404', { tag: '@api' }, async ({
  request,
}) => {
  // executed — unknown invoiceId → 404, no rule
  const response = await request.get('/invoices/inv-does-not-exist');
  expect(response.status()).toBe(404);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBeUndefined();
});

// --- POST /invoices/{invoiceId}/match ---

test('INV-M-01 POST /invoices/{invoiceId}/match full 3-way match', { tag: '@api' }, async ({
  request,
}) => {
  // executed — full receive + full invoice → match passed, partial_receipt false
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);
  const { body: invoice } = await createInvoice(request, {
    po_id: po.id,
    invoice_number: uniqueInvoiceNumber(),
    line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });

  const response = await request.post(`/invoices/${invoice.id}/match`);
  expect(response.status()).toBe(200);

  const body = await response.json();
  await expectSchema(request, body, 'MatchResult');
  expect(body.invoice_id).toBe(invoice.id);
  expect(body.po_id).toBe(po.id);
  expect(body.status).toBe('matched');
  expect(body.matched).toBe(true);
  expect(body.partial_receipt).toBe(false);
  expect(body.ordered_value).toBe(47.5);
  expect(body.received_value).toBe(47.5);
  expect(body.invoice_total).toBe(47.5);
  expect(body.message).toBe('3-way match passed.');
});

test('INV-M-02 POST /invoices/{invoiceId}/match sets partial_receipt true', { tag: '@api' }, async ({
  request,
}) => {
  // executed — partial PO receive → match with partial_receipt:true
  const po = await createSubmittedPo(request, [{ ...LUM_LINE }, { ...CEM_LINE }]);
  await receivePo(request, po.id, [{ sku: 'LUM-2X4-8', quantity: 5 }]);

  const { body: invoice } = await createInvoice(request, {
    po_id: po.id,
    invoice_number: uniqueInvoiceNumber(),
    line_items: [{ sku: 'LUM-2X4-8', quantity: 5, unit_price: 4.75 }],
  });

  const response = await request.post(`/invoices/${invoice.id}/match`);
  expect(response.status()).toBe(200);

  const body = await response.json();
  await expectSchema(request, body, 'MatchResult');
  expect(body.matched).toBe(true);
  expect(body.status).toBe('matched');
  expect(body.partial_receipt).toBe(true);
});

test('INV-M-03 POST /invoices/{invoiceId}/match full receive partial invoice', { tag: '@api' }, async ({
  request,
}) => {
  // executed — full PO receive, partial invoice → partial_receipt:false
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);
  const { body: invoice } = await createInvoice(request, {
    po_id: po.id,
    invoice_number: uniqueInvoiceNumber(),
    line_items: [{ sku: 'LUM-2X4-8', quantity: 5, unit_price: 4.75 }],
  });

  const response = await request.post(`/invoices/${invoice.id}/match`);
  expect(response.status()).toBe(200);

  const body = await response.json();
  await expectSchema(request, body, 'MatchResult');
  expect(body.matched).toBe(true);
  expect(body.partial_receipt).toBe(false);
  expect(body.invoice_total).toBe(23.75);
});

test('INV-M-04 POST /invoices/{invoiceId}/match unknown id returns 404', { tag: '@api' }, async ({
  request,
}) => {
  // executed — match unknown invoiceId → 404, no rule
  const response = await request.post('/invoices/inv-does-not-exist/match');
  expect(response.status()).toBe(404);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBeUndefined();
});

test('INV-M-05 POST /invoices/{invoiceId}/match after approve returns workflow_gate', { tag: '@api' }, async ({
  request,
}) => {
  // executed — match → approve → match again → workflow_gate
  const po = await createFullyReceivedPo(request, [{ ...LUM_LINE }]);
  const { body: invoice } = await createInvoice(request, {
    po_id: po.id,
    invoice_number: uniqueInvoiceNumber(),
    line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });

  const matchResponse = await request.post(`/invoices/${invoice.id}/match`);
  expect(matchResponse.status()).toBe(200);
  await expectSchema(request, await matchResponse.json(), 'MatchResult');

  const approveResponse = await request.post(`/invoices/${invoice.id}/approve`);
  expect(approveResponse.status()).toBe(200);

  const response = await request.post(`/invoices/${invoice.id}/match`);
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('workflow_gate');
});
