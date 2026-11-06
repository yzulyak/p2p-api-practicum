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

const CEM_LINE = {
  sku: 'CEM-30KG',
  quantity: 4,
  unit_price: 11.9,
} as const;

const INVOICE_TOTAL = 95.1;

test.describe.configure({ mode: 'serial' });

let vendorId: string;
let poId: string;
let invoiceId: string;
let invoiceTotal: number;

test('E2E-FF-01 create vendor for full flow', { tag: '@e2e' }, async ({ request }) => {
  // executed — dedicated vendor so exposure belongs only to this flow
  const response = await request.post('/vendors', {
    data: { name: `Full-Flow-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}` },
  });
  expect(response.status()).toBe(201);

  const body = await response.json();
  await expectSchema(request, body, 'Vendor');
  expect(body.id.startsWith('vnd-')).toBe(true);
  expect(body.active).toBe(true);

  vendorId = body.id;
});

test('E2E-FF-02 create draft PO with two lines', { tag: '@e2e' }, async ({ request }) => {
  // executed — two-line draft PO for the flow vendor
  const response = await request.post('/purchase-orders', {
    data: {
      vendor_id: vendorId,
      line_items: [{ ...LUM_LINE }, { ...CEM_LINE }],
    },
  });
  expect(response.status()).toBe(201);

  const body = (await response.json()) as PurchaseOrder;
  await expectSchema(request, body, 'PurchaseOrder');
  expect(body.status).toBe('draft');
  expect(body.vendor_id).toBe(vendorId);
  expect(body.line_items).toHaveLength(2);
  expect(body.ordered_value).toBe(INVOICE_TOTAL);
  expect(body.fully_received).toBe(false);

  poId = body.id;
});

test('E2E-FF-03 submit purchase order', { tag: '@e2e' }, async ({ request }) => {
  // executed — draft → submitted
  const response = await request.post(`/purchase-orders/${poId}/submit`);
  expect(response.status()).toBe(200);

  const body = (await response.json()) as PurchaseOrder;
  await expectSchema(request, body, 'PurchaseOrder');
  expect(body.id).toBe(poId);
  expect(body.status).toBe('submitted');
});

test('E2E-FF-04 receive everything', { tag: '@e2e' }, async ({ request }) => {
  // executed — full receipt closes the PO
  const response = await request.post(`/purchase-orders/${poId}/receive`, {
    data: {
      items: [
        { sku: 'LUM-2X4-8', quantity: 10 },
        { sku: 'CEM-30KG', quantity: 4 },
      ],
    },
  });
  expect(response.status()).toBe(200);

  const body = (await response.json()) as PurchaseOrder;
  await expectSchema(request, body, 'PurchaseOrder');
  expect(body.status).toBe('closed');
  expect(body.fully_received).toBe(true);
  expect(body.received_value).toBe(INVOICE_TOTAL);
  expect(body.received_value).toBe(body.ordered_value);
});

test('E2E-FF-05 invoice everything received', { tag: '@e2e' }, async ({ request }) => {
  // executed — invoice covers full received quantities at PO prices
  const response = await request.post('/invoices', {
    data: {
      po_id: poId,
      invoice_number: `INV-FF-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
      line_items: [
        { sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 },
        { sku: 'CEM-30KG', quantity: 4, unit_price: 11.9 },
      ],
    },
  });
  expect(response.status()).toBe(201);

  const body = (await response.json()) as Invoice;
  await expectSchema(request, body, 'Invoice');
  expect(body.po_id).toBe(poId);
  expect(body.vendor_id).toBe(vendorId);
  expect(body.status).toBe('received');
  expect(body.matched).toBe(false);
  expect(body.partial_receipt).toBeNull();
  expect(body.total_amount).toBe(INVOICE_TOTAL);

  invoiceId = body.id;
  invoiceTotal = body.total_amount;
});

test('E2E-FF-06 match with partial_receipt false', { tag: '@e2e' }, async ({ request }) => {
  // executed — full 3-way match → partial_receipt false
  const response = await request.post(`/invoices/${invoiceId}/match`);
  expect(response.status()).toBe(200);

  const body = await response.json();
  await expectSchema(request, body, 'MatchResult');
  expect(body.invoice_id).toBe(invoiceId);
  expect(body.po_id).toBe(poId);
  expect(body.status).toBe('matched');
  expect(body.matched).toBe(true);
  expect(body.partial_receipt).toBe(false);
  expect(body.invoice_total).toBe(invoiceTotal);
  expect(body.ordered_value).toBe(invoiceTotal);
  expect(body.received_value).toBe(invoiceTotal);
});

test('E2E-FF-07 approve balanced ledger equals invoice total', { tag: '@e2e' }, async ({
  request,
}) => {
  // executed — approve posts balanced GL; debit = credit = invoice total
  const response = await request.post(`/invoices/${invoiceId}/approve`);
  expect(response.status()).toBe(200);

  const body = (await response.json()) as ApproveResult;
  await expectSchema(request, body, 'ApproveResult');
  expect(body.invoice_id).toBe(invoiceId);
  expect(body.status).toBe('approved');
  expect(body.gl_entry.balanced).toBe(true);
  expect(body.gl_entry.debits).toEqual([
    { account: '5000 Materials Expense', amount: invoiceTotal },
  ]);
  expect(body.gl_entry.credits).toEqual([
    { account: '2000 Accounts Payable', amount: invoiceTotal },
  ]);

  const debitTotal = body.gl_entry.debits.reduce((sum, line) => sum + line.amount, 0);
  const creditTotal = body.gl_entry.credits.reduce((sum, line) => sum + line.amount, 0);
  expect(debitTotal).toBe(creditTotal);
  expect(debitTotal).toBe(invoiceTotal);
  expect(body.vendor_exposure).toBe(invoiceTotal);
});

test('E2E-FF-08 exposure equals invoice total and lists invoice id', { tag: '@e2e' }, async ({
  request,
}) => {
  // executed — vendor exposure = invoice total and includes this invoice id
  const response = await request.get(`/vendors/${vendorId}/exposure`);
  expect(response.status()).toBe(200);

  const body = (await response.json()) as VendorExposure;
  await expectSchema(request, body, 'VendorExposure');
  expect(body.vendor_id).toBe(vendorId);
  expect(body.open_ap_liability).toBe(invoiceTotal);
  expect(body.approved_invoices).toEqual([invoiceId]);
});
