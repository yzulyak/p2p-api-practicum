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

type ApproveResult = {
  invoice_id: string;
  status: string;
  gl_entry: {
    debits: Array<{ account: string; amount: number }>;
    credits: Array<{ account: string; amount: number }>;
    balanced: boolean;
  };
  vendor_exposure: number;
};

type VendorExposure = {
  vendor_id: string;
  open_ap_liability: number;
  approved_invoices: string[];
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

async function createVendor(
  request: APIRequestContext,
  name = `Approve-Exp-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
): Promise<{ id: string; name: string; active: boolean }> {
  const response = await request.post('/vendors', { data: { name } });
  expect(response.status()).toBe(201);
  const vendor = await response.json();
  await expectSchema(request, vendor, 'Vendor');
  return vendor;
}

async function createDraftPo(
  request: APIRequestContext,
  vendorId: string,
  lineItems: Array<Record<string, unknown>> = [{ ...LUM_LINE }],
): Promise<PurchaseOrder> {
  const response = await request.post('/purchase-orders', {
    data: { vendor_id: vendorId, line_items: lineItems },
  });
  expect(response.status()).toBe(201);
  const po = await response.json();
  await expectSchema(request, po, 'PurchaseOrder');
  return po as PurchaseOrder;
}

async function createSubmittedPo(
  request: APIRequestContext,
  vendorId: string,
  lineItems: Array<Record<string, unknown>> = [{ ...LUM_LINE }],
): Promise<PurchaseOrder> {
  const draft = await createDraftPo(request, vendorId, lineItems);
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
  vendorId: string,
  lineItems: Array<Record<string, unknown>> = [{ ...LUM_LINE }],
): Promise<PurchaseOrder> {
  const po = await createSubmittedPo(request, vendorId, lineItems);
  const receiveItems = lineItems.map((line) => ({
    sku: String(line.sku),
    quantity: Number(line.quantity),
  }));
  return receivePo(request, po.id, receiveItems);
}

async function createInvoice(
  request: APIRequestContext,
  data: Record<string, unknown>,
): Promise<Invoice> {
  const response = await request.post('/invoices', { data });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as Invoice;
  await expectSchema(request, body, 'Invoice');
  return body;
}

async function matchInvoice(request: APIRequestContext, invoiceId: string): Promise<void> {
  const response = await request.post(`/invoices/${invoiceId}/match`);
  expect(response.status()).toBe(200);
  await expectSchema(request, await response.json(), 'MatchResult');
}

async function createMatchedInvoice(
  request: APIRequestContext,
  options: {
    vendorId: string;
    poLineItems?: Array<Record<string, unknown>>;
    invoiceLineItems: Array<{ sku: string; quantity: number; unit_price: number }>;
    receiveItems?: Array<{ sku: string; quantity: number }>;
    fullyReceive?: boolean;
  },
): Promise<{ po: PurchaseOrder; invoice: Invoice }> {
  const poLineItems = options.poLineItems ?? [{ ...LUM_LINE }];
  let po: PurchaseOrder;
  if (options.fullyReceive === false) {
    po = await createSubmittedPo(request, options.vendorId, poLineItems);
    if (options.receiveItems) {
      po = await receivePo(request, po.id, options.receiveItems);
    }
  } else {
    po = await createFullyReceivedPo(request, options.vendorId, poLineItems);
  }

  const invoice = await createInvoice(request, {
    po_id: po.id,
    invoice_number: uniqueInvoiceNumber(),
    line_items: options.invoiceLineItems,
  });
  await matchInvoice(request, invoice.id);
  return { po, invoice };
}

function assertGlBalanced(
  gl: ApproveResult['gl_entry'],
  expectedAmount: number,
): void {
  expect(gl.balanced).toBe(true);
  expect(gl.debits).toEqual([
    { account: '5000 Materials Expense', amount: expectedAmount },
  ]);
  expect(gl.credits).toEqual([
    { account: '2000 Accounts Payable', amount: expectedAmount },
  ]);
  const debitTotal = gl.debits.reduce((sum, line) => sum + line.amount, 0);
  const creditTotal = gl.credits.reduce((sum, line) => sum + line.amount, 0);
  expect(debitTotal).toBe(creditTotal);
  expect(debitTotal).toBe(expectedAmount);
}

// --- POST /invoices/{invoiceId}/approve ---

test('APP-01 POST /invoices/{invoiceId}/approve single-line full match', { tag: '@api' }, async ({
  request,
}) => {
  // executed — LUM 10 @ 4.75 fully received/matched → approve 47.5 balanced GL
  const vendor = await createVendor(request);
  const { invoice } = await createMatchedInvoice(request, {
    vendorId: vendor.id,
    invoiceLineItems: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });

  const response = await request.post(`/invoices/${invoice.id}/approve`);
  expect(response.status()).toBe(200);

  const body = (await response.json()) as ApproveResult;
  await expectSchema(request, body, 'ApproveResult');
  expect(body.invoice_id).toBe(invoice.id);
  expect(body.status).toBe('approved');
  assertGlBalanced(body.gl_entry, 47.5);
  expect(body.vendor_exposure).toBe(47.5);
});

test('APP-02 POST /invoices/{invoiceId}/approve multi-line closed PO', { tag: '@api' }, async ({
  request,
}) => {
  // executed — LUM+CEM fully received/matched → approve 95.1
  const vendor = await createVendor(request);
  const { po, invoice } = await createMatchedInvoice(request, {
    vendorId: vendor.id,
    poLineItems: [{ ...LUM_LINE }, { ...CEM_LINE }],
    invoiceLineItems: [
      { sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 },
      { sku: 'CEM-30KG', quantity: 4, unit_price: 11.9 },
    ],
  });
  expect(po.status).toBe('closed');

  const response = await request.post(`/invoices/${invoice.id}/approve`);
  expect(response.status()).toBe(200);

  const body = (await response.json()) as ApproveResult;
  await expectSchema(request, body, 'ApproveResult');
  expect(body.invoice_id).toBe(invoice.id);
  expect(body.status).toBe('approved');
  assertGlBalanced(body.gl_entry, 95.1);
  expect(body.vendor_exposure).toBe(95.1);
});

test('APP-03 POST /invoices/{invoiceId}/approve with partial_receipt', { tag: '@api' }, async ({
  request,
}) => {
  // executed — receive 5 of 10, invoice 5, match partial_receipt → approve 23.75
  const vendor = await createVendor(request);
  const { invoice } = await createMatchedInvoice(request, {
    vendorId: vendor.id,
    fullyReceive: false,
    receiveItems: [{ sku: 'LUM-2X4-8', quantity: 5 }],
    invoiceLineItems: [{ sku: 'LUM-2X4-8', quantity: 5, unit_price: 4.75 }],
  });

  const getBefore = await request.get(`/invoices/${invoice.id}`);
  expect(getBefore.status()).toBe(200);
  const before = (await getBefore.json()) as Invoice;
  await expectSchema(request, before, 'Invoice');
  expect(before.matched).toBe(true);
  expect(before.partial_receipt).toBe(true);

  const response = await request.post(`/invoices/${invoice.id}/approve`);
  expect(response.status()).toBe(200);

  const body = (await response.json()) as ApproveResult;
  await expectSchema(request, body, 'ApproveResult');
  expect(body.status).toBe('approved');
  assertGlBalanced(body.gl_entry, 23.75);
  expect(body.vendor_exposure).toBe(23.75);
});

test('APP-04 POST /invoices/{invoiceId}/approve zero-amount invoice', { tag: '@api' }, async ({
  request,
}) => {
  // executed — qty 1 @ unit_price 0 matched → approve with amount 0
  const vendor = await createVendor(request);
  const { invoice } = await createMatchedInvoice(request, {
    vendorId: vendor.id,
    invoiceLineItems: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 0 }],
  });
  expect(invoice.total_amount).toBe(0);

  const response = await request.post(`/invoices/${invoice.id}/approve`);
  expect(response.status()).toBe(200);

  const body = (await response.json()) as ApproveResult;
  await expectSchema(request, body, 'ApproveResult');
  expect(body.status).toBe('approved');
  assertGlBalanced(body.gl_entry, 0);
  expect(body.vendor_exposure).toBe(0);
});

test('APP-05 POST /invoices/{invoiceId}/approve cumulative vendor_exposure', { tag: '@api' }, async ({
  request,
}) => {
  // executed — approve 47.5 then 23.75 → second approve vendor_exposure 71.25
  const vendor = await createVendor(request);

  const first = await createMatchedInvoice(request, {
    vendorId: vendor.id,
    invoiceLineItems: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });
  const firstApprove = await request.post(`/invoices/${first.invoice.id}/approve`);
  expect(firstApprove.status()).toBe(200);
  const firstBody = (await firstApprove.json()) as ApproveResult;
  await expectSchema(request, firstBody, 'ApproveResult');
  expect(firstBody.vendor_exposure).toBe(47.5);

  const second = await createMatchedInvoice(request, {
    vendorId: vendor.id,
    invoiceLineItems: [{ sku: 'LUM-2X4-8', quantity: 5, unit_price: 4.75 }],
  });

  const response = await request.post(`/invoices/${second.invoice.id}/approve`);
  expect(response.status()).toBe(200);

  const body = (await response.json()) as ApproveResult;
  await expectSchema(request, body, 'ApproveResult');
  expect(body.status).toBe('approved');
  assertGlBalanced(body.gl_entry, 23.75);
  expect(body.vendor_exposure).toBe(71.25);
});

test('APP-06 GET /invoices/{invoiceId} after approve shows approved', { tag: '@api' }, async ({
  request,
}) => {
  // executed — after approve, GET invoice status approved, matched true, total unchanged
  const vendor = await createVendor(request);
  const { invoice } = await createMatchedInvoice(request, {
    vendorId: vendor.id,
    invoiceLineItems: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });

  const approveResponse = await request.post(`/invoices/${invoice.id}/approve`);
  expect(approveResponse.status()).toBe(200);
  await expectSchema(request, await approveResponse.json(), 'ApproveResult');

  const response = await request.get(`/invoices/${invoice.id}`);
  expect(response.status()).toBe(200);

  const body = (await response.json()) as Invoice;
  await expectSchema(request, body, 'Invoice');
  expect(body.status).toBe('approved');
  expect(body.matched).toBe(true);
  expect(body.total_amount).toBe(47.5);
});

test('APP-07 POST /invoices/{invoiceId}/approve unknown id returns 404', { tag: '@api' }, async ({
  request,
}) => {
  // executed — approve unknown invoiceId → 404, no rule
  const response = await request.post('/invoices/inv-does-not-exist/approve');
  expect(response.status()).toBe(404);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBeUndefined();
});

test('APP-08 POST /invoices/{invoiceId}/approve unmatched returns three_way_match_gate', { tag: '@api' }, async ({
  request,
}) => {
  // executed — invoice received only (not matched) → 400 three_way_match_gate
  const vendor = await createVendor(request);
  const po = await createFullyReceivedPo(request, vendor.id, [{ ...LUM_LINE }]);
  const invoice = await createInvoice(request, {
    po_id: po.id,
    invoice_number: uniqueInvoiceNumber(),
    line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });
  expect(invoice.status).toBe('received');
  expect(invoice.matched).toBe(false);

  const response = await request.post(`/invoices/${invoice.id}/approve`);
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('three_way_match_gate');
});

test('APP-09 POST /invoices/{invoiceId}/approve twice returns duplicate_approval', { tag: '@api' }, async ({
  request,
}) => {
  // executed — second approve on same id → 400 duplicate_approval
  const vendor = await createVendor(request);
  const { invoice } = await createMatchedInvoice(request, {
    vendorId: vendor.id,
    invoiceLineItems: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });

  const first = await request.post(`/invoices/${invoice.id}/approve`);
  expect(first.status()).toBe(200);
  await expectSchema(request, await first.json(), 'ApproveResult');

  const response = await request.post(`/invoices/${invoice.id}/approve`);
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('duplicate_approval');
});

// --- GET /vendors/{vendorId}/exposure ---

test('EXP-01 GET /vendors/vnd-001/exposure empty after seed', { tag: '@api' }, async ({
  request,
}) => {
  // executed — seed vnd-001 with no approvals → open_ap_liability 0
  const response = await request.get('/vendors/vnd-001/exposure');
  expect(response.status()).toBe(200);

  const body = (await response.json()) as VendorExposure;
  await expectSchema(request, body, 'VendorExposure');
  expect(body.vendor_id).toBe('vnd-001');
  expect(body.open_ap_liability).toBe(0);
  expect(body.approved_invoices).toEqual([]);
});

test('EXP-02 GET /vendors/vnd-002/exposure empty inactive seed', { tag: '@api' }, async ({
  request,
}) => {
  // executed — inactive seed vnd-002 known → exposure 0 empty list
  const response = await request.get('/vendors/vnd-002/exposure');
  expect(response.status()).toBe(200);

  const body = (await response.json()) as VendorExposure;
  await expectSchema(request, body, 'VendorExposure');
  expect(body.vendor_id).toBe('vnd-002');
  expect(body.open_ap_liability).toBe(0);
  expect(body.approved_invoices).toEqual([]);
});

test('EXP-03 GET /vendors/{vendorId}/exposure for newly created vendor', { tag: '@api' }, async ({
  request,
}) => {
  // executed — new vendor with no approvals → empty exposure
  const vendor = await createVendor(request, `Exp-New-${Date.now()}`);

  const response = await request.get(`/vendors/${vendor.id}/exposure`);
  expect(response.status()).toBe(200);

  const body = (await response.json()) as VendorExposure;
  await expectSchema(request, body, 'VendorExposure');
  expect(body.vendor_id).toBe(vendor.id);
  expect(body.open_ap_liability).toBe(0);
  expect(body.approved_invoices).toEqual([]);
});

test('EXP-04 GET /vendors/{vendorId}/exposure after one approval', { tag: '@api' }, async ({
  request,
}) => {
  // executed — one approved invoice 47.5 → liability 47.5, one id in list
  const vendor = await createVendor(request);
  const { invoice } = await createMatchedInvoice(request, {
    vendorId: vendor.id,
    invoiceLineItems: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });

  const approveResponse = await request.post(`/invoices/${invoice.id}/approve`);
  expect(approveResponse.status()).toBe(200);
  await expectSchema(request, await approveResponse.json(), 'ApproveResult');

  const response = await request.get(`/vendors/${vendor.id}/exposure`);
  expect(response.status()).toBe(200);

  const body = (await response.json()) as VendorExposure;
  await expectSchema(request, body, 'VendorExposure');
  expect(body.vendor_id).toBe(vendor.id);
  expect(body.open_ap_liability).toBe(47.5);
  expect(body.approved_invoices).toHaveLength(1);
  expect(body.approved_invoices).toContain(invoice.id);
});

test('EXP-05 GET /vendors/{vendorId}/exposure sum of two approvals', { tag: '@api' }, async ({
  request,
}) => {
  // executed — approve 47.5 and 23.75 → open_ap_liability 71.25, length 2
  const vendor = await createVendor(request);

  const first = await createMatchedInvoice(request, {
    vendorId: vendor.id,
    invoiceLineItems: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });
  const firstApprove = await request.post(`/invoices/${first.invoice.id}/approve`);
  expect(firstApprove.status()).toBe(200);
  await expectSchema(request, await firstApprove.json(), 'ApproveResult');

  const second = await createMatchedInvoice(request, {
    vendorId: vendor.id,
    invoiceLineItems: [{ sku: 'LUM-2X4-8', quantity: 5, unit_price: 4.75 }],
  });
  const secondApprove = await request.post(`/invoices/${second.invoice.id}/approve`);
  expect(secondApprove.status()).toBe(200);
  await expectSchema(request, await secondApprove.json(), 'ApproveResult');

  const response = await request.get(`/vendors/${vendor.id}/exposure`);
  expect(response.status()).toBe(200);

  const body = (await response.json()) as VendorExposure;
  await expectSchema(request, body, 'VendorExposure');
  expect(body.open_ap_liability).toBe(71.25);
  expect(body.approved_invoices).toHaveLength(2);
  expect(body.approved_invoices).toEqual(
    expect.arrayContaining([first.invoice.id, second.invoice.id]),
  );
});

test('EXP-06 GET /vendors/{vendorId}/exposure ignores matched-only invoice', { tag: '@api' }, async ({
  request,
}) => {
  // executed — matched but not approved → liability still 0
  const vendor = await createVendor(request);
  await createMatchedInvoice(request, {
    vendorId: vendor.id,
    invoiceLineItems: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });

  const response = await request.get(`/vendors/${vendor.id}/exposure`);
  expect(response.status()).toBe(200);

  const body = (await response.json()) as VendorExposure;
  await expectSchema(request, body, 'VendorExposure');
  expect(body.open_ap_liability).toBe(0);
  expect(body.approved_invoices).toEqual([]);
});

test('EXP-07 GET /vendors/{vendorId}/exposure isolated across vendors', { tag: '@api' }, async ({
  request,
}) => {
  // executed — each vendor liability lists only that vendor's approved ids
  const vendorA = await createVendor(request, `Exp-A-${Date.now()}`);
  const vendorB = await createVendor(request, `Exp-B-${Date.now()}`);

  const invoiceA = await createMatchedInvoice(request, {
    vendorId: vendorA.id,
    invoiceLineItems: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });
  const approveA = await request.post(`/invoices/${invoiceA.invoice.id}/approve`);
  expect(approveA.status()).toBe(200);
  await expectSchema(request, await approveA.json(), 'ApproveResult');

  const invoiceB = await createMatchedInvoice(request, {
    vendorId: vendorB.id,
    invoiceLineItems: [{ sku: 'LUM-2X4-8', quantity: 5, unit_price: 4.75 }],
  });
  const approveB = await request.post(`/invoices/${invoiceB.invoice.id}/approve`);
  expect(approveB.status()).toBe(200);
  await expectSchema(request, await approveB.json(), 'ApproveResult');

  const responseA = await request.get(`/vendors/${vendorA.id}/exposure`);
  expect(responseA.status()).toBe(200);
  const bodyA = (await responseA.json()) as VendorExposure;
  await expectSchema(request, bodyA, 'VendorExposure');
  expect(bodyA.vendor_id).toBe(vendorA.id);
  expect(bodyA.open_ap_liability).toBe(47.5);
  expect(bodyA.approved_invoices).toEqual([invoiceA.invoice.id]);

  const responseB = await request.get(`/vendors/${vendorB.id}/exposure`);
  expect(responseB.status()).toBe(200);
  const bodyB = (await responseB.json()) as VendorExposure;
  await expectSchema(request, bodyB, 'VendorExposure');
  expect(bodyB.vendor_id).toBe(vendorB.id);
  expect(bodyB.open_ap_liability).toBe(23.75);
  expect(bodyB.approved_invoices).toEqual([invoiceB.invoice.id]);
});

test('EXP-08 approve vendor_exposure matches GET open_ap_liability', { tag: '@api' }, async ({
  request,
}) => {
  // executed — approve body's vendor_exposure equals GET exposure open_ap_liability
  const vendor = await createVendor(request);
  const { invoice } = await createMatchedInvoice(request, {
    vendorId: vendor.id,
    invoiceLineItems: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });

  const approveResponse = await request.post(`/invoices/${invoice.id}/approve`);
  expect(approveResponse.status()).toBe(200);
  const approveBody = (await approveResponse.json()) as ApproveResult;
  await expectSchema(request, approveBody, 'ApproveResult');

  const response = await request.get(`/vendors/${vendor.id}/exposure`);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as VendorExposure;
  await expectSchema(request, body, 'VendorExposure');

  expect(approveBody.vendor_exposure).toBe(body.open_ap_liability);
});

test('EXP-09 GET /vendors/{vendorId}/exposure unknown id returns 404', { tag: '@api' }, async ({
  request,
}) => {
  // executed — unknown vendorId → 404, no rule
  const response = await request.get('/vendors/vnd-does-not-exist/exposure');
  expect(response.status()).toBe(404);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBeUndefined();
});
