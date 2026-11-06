import { test, expect } from '@playwright/test';
import { expectSchema } from '../helpers/schema';

type PoLine = {
  sku: string;
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

const INVOICE_TOTAL = 47.5;

test.describe.configure({ mode: 'serial' });

let vendorId: string;
let poId: string;
let invoiceId: string;

test('E2E-OI-01 create vendor for over-invoice flow', { tag: '@e2e' }, async ({ request }) => {
  // executed — dedicated vendor so exposure belongs only to this flow
  const response = await request.post('/vendors', {
    data: { name: `Over-Invoice-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}` },
  });
  expect(response.status()).toBe(201);

  const body = await response.json();
  await expectSchema(request, body, 'Vendor');
  expect(body.id.startsWith('vnd-')).toBe(true);

  vendorId = body.id;
});

test('E2E-OI-02 create submit and fully receive purchase order', { tag: '@e2e' }, async ({
  request,
}) => {
  // executed — PO → submit → receive everything
  const createResponse = await request.post('/purchase-orders', {
    data: {
      vendor_id: vendorId,
      line_items: [{ ...LUM_LINE }],
    },
  });
  expect(createResponse.status()).toBe(201);
  const draft = (await createResponse.json()) as PurchaseOrder;
  await expectSchema(request, draft, 'PurchaseOrder');
  expect(draft.status).toBe('draft');

  const submitResponse = await request.post(`/purchase-orders/${draft.id}/submit`);
  expect(submitResponse.status()).toBe(200);
  const submitted = (await submitResponse.json()) as PurchaseOrder;
  await expectSchema(request, submitted, 'PurchaseOrder');
  expect(submitted.status).toBe('submitted');

  const receiveResponse = await request.post(`/purchase-orders/${draft.id}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 10 }] },
  });
  expect(receiveResponse.status()).toBe(200);
  const received = (await receiveResponse.json()) as PurchaseOrder;
  await expectSchema(request, received, 'PurchaseOrder');
  expect(received.status).toBe('closed');
  expect(received.fully_received).toBe(true);
  expect(received.received_value).toBe(INVOICE_TOTAL);

  poId = received.id;
});

test('E2E-OI-03 over-invoice rejected with overpayment_protection', { tag: '@e2e' }, async ({
  request,
}) => {
  // executed — invoice one unit more than received → 400 overpayment_protection
  const response = await request.post('/invoices', {
    data: {
      po_id: poId,
      invoice_number: `INV-OI-OVER-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
      line_items: [{ sku: 'LUM-2X4-8', quantity: 11, unit_price: 4.75 }],
    },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('overpayment_protection');
});

test('E2E-OI-04 exposure remains 0 after rejected over-invoice', { tag: '@e2e' }, async ({
  request,
}) => {
  // executed — rejected invoice does not create AP liability
  const response = await request.get(`/vendors/${vendorId}/exposure`);
  expect(response.status()).toBe(200);

  const body = (await response.json()) as VendorExposure;
  await expectSchema(request, body, 'VendorExposure');
  expect(body.vendor_id).toBe(vendorId);
  expect(body.open_ap_liability).toBe(0);
  expect(body.approved_invoices).toEqual([]);
});

test('E2E-OI-05 correct invoice accepted matched and approved', { tag: '@e2e' }, async ({
  request,
}) => {
  // executed — correct invoice → match → approve → exposure = invoice total
  const createResponse = await request.post('/invoices', {
    data: {
      po_id: poId,
      invoice_number: `INV-OI-OK-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
      line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
    },
  });
  expect(createResponse.status()).toBe(201);
  const invoice = (await createResponse.json()) as Invoice;
  await expectSchema(request, invoice, 'Invoice');
  expect(invoice.status).toBe('received');
  expect(invoice.total_amount).toBe(INVOICE_TOTAL);
  invoiceId = invoice.id;

  const matchResponse = await request.post(`/invoices/${invoiceId}/match`);
  expect(matchResponse.status()).toBe(200);
  const matchBody = await matchResponse.json();
  await expectSchema(request, matchBody, 'MatchResult');
  expect(matchBody.matched).toBe(true);
  expect(matchBody.partial_receipt).toBe(false);
  expect(matchBody.invoice_total).toBe(INVOICE_TOTAL);

  const approveResponse = await request.post(`/invoices/${invoiceId}/approve`);
  expect(approveResponse.status()).toBe(200);
  const approveBody = (await approveResponse.json()) as ApproveResult;
  await expectSchema(request, approveBody, 'ApproveResult');
  expect(approveBody.status).toBe('approved');
  expect(approveBody.gl_entry.balanced).toBe(true);
  expect(approveBody.vendor_exposure).toBe(INVOICE_TOTAL);

  const exposureResponse = await request.get(`/vendors/${vendorId}/exposure`);
  expect(exposureResponse.status()).toBe(200);
  const exposure = (await exposureResponse.json()) as VendorExposure;
  await expectSchema(request, exposure, 'VendorExposure');
  expect(exposure.open_ap_liability).toBe(INVOICE_TOTAL);
  expect(exposure.approved_invoices).toEqual([invoiceId]);
});
