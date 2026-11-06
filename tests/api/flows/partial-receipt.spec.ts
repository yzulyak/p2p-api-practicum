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

const ORDERED_VALUE = 95.1;
/** LUM 10 @ 4.75 + CEM 2 @ 11.9 */
const RECEIVED_VALUE = 71.3;

test.describe.configure({ mode: 'serial' });

let vendorId: string;
let poId: string;
let invoiceId: string;
let receivedValue: number;

function lineBySku(po: PurchaseOrder, sku: string): PoLine {
  const line = po.line_items.find((item) => item.sku === sku);
  expect(line).toBeDefined();
  return line!;
}

test('E2E-PR-01 create vendor for partial receipt flow', { tag: '@e2e' }, async ({ request }) => {
  // executed — dedicated vendor so exposure belongs only to this flow
  const response = await request.post('/vendors', {
    data: { name: `Partial-Receipt-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}` },
  });
  expect(response.status()).toBe(201);

  const body = await response.json();
  await expectSchema(request, body, 'Vendor');
  expect(body.id.startsWith('vnd-')).toBe(true);

  vendorId = body.id;
});

test('E2E-PR-02 create and submit two-line purchase order', { tag: '@e2e' }, async ({
  request,
}) => {
  // executed — draft two-line PO then submit
  const createResponse = await request.post('/purchase-orders', {
    data: {
      vendor_id: vendorId,
      line_items: [{ ...LUM_LINE }, { ...CEM_LINE }],
    },
  });
  expect(createResponse.status()).toBe(201);
  const draft = (await createResponse.json()) as PurchaseOrder;
  await expectSchema(request, draft, 'PurchaseOrder');
  expect(draft.status).toBe('draft');
  expect(draft.ordered_value).toBe(ORDERED_VALUE);

  const submitResponse = await request.post(`/purchase-orders/${draft.id}/submit`);
  expect(submitResponse.status()).toBe(200);
  const submitted = (await submitResponse.json()) as PurchaseOrder;
  await expectSchema(request, submitted, 'PurchaseOrder');
  expect(submitted.status).toBe('submitted');

  poId = submitted.id;
});

test('E2E-PR-03 receive first line full and second line partial', { tag: '@e2e' }, async ({
  request,
}) => {
  // executed — LUM 10 full, CEM 2 of 4 → still submitted, not fully received
  const response = await request.post(`/purchase-orders/${poId}/receive`, {
    data: {
      items: [
        { sku: 'LUM-2X4-8', quantity: 10 },
        { sku: 'CEM-30KG', quantity: 2 },
      ],
    },
  });
  expect(response.status()).toBe(200);

  const body = (await response.json()) as PurchaseOrder;
  await expectSchema(request, body, 'PurchaseOrder');
  expect(body.status).toBe('submitted');
  expect(body.fully_received).toBe(false);
  expect(lineBySku(body, 'LUM-2X4-8').received_quantity).toBe(10);
  expect(lineBySku(body, 'CEM-30KG').received_quantity).toBe(2);
  expect(body.ordered_value).toBe(ORDERED_VALUE);
  expect(body.received_value).toBe(RECEIVED_VALUE);
  expect(body.received_value).not.toBe(body.ordered_value);

  receivedValue = body.received_value;
});

test('E2E-PR-04 invoice only what was received', { tag: '@e2e' }, async ({ request }) => {
  // executed — invoice quantities match received amounts only
  const response = await request.post('/invoices', {
    data: {
      po_id: poId,
      invoice_number: `INV-PR-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
      line_items: [
        { sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 },
        { sku: 'CEM-30KG', quantity: 2, unit_price: 11.9 },
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
  expect(body.total_amount).toBe(receivedValue);

  invoiceId = body.id;
});

test('E2E-PR-05 match with partial_receipt true', { tag: '@e2e' }, async ({ request }) => {
  // executed — PO not fully received → match sets partial_receipt true
  test.fail(true, 'BUG-3: match returns partial_receipt false when a later PO line is not fully received');
  const response = await request.post(`/invoices/${invoiceId}/match`);
  expect(response.status()).toBe(200);

  const body = await response.json();
  await expectSchema(request, body, 'MatchResult');
  expect(body.invoice_id).toBe(invoiceId);
  expect(body.po_id).toBe(poId);
  expect(body.status).toBe('matched');
  expect(body.matched).toBe(true);
  expect(body.partial_receipt).toBe(true);
  expect(body.ordered_value).toBe(ORDERED_VALUE);
  expect(body.received_value).toBe(receivedValue);
  expect(body.invoice_total).toBe(receivedValue);
});

test('E2E-PR-06 approve then exposure equals received not ordered', { tag: '@e2e' }, async ({
  request,
}) => {
  // executed — approve; exposure = received value, not ordered value
  const approveResponse = await request.post(`/invoices/${invoiceId}/approve`);
  expect(approveResponse.status()).toBe(200);

  const approveBody = (await approveResponse.json()) as ApproveResult;
  await expectSchema(request, approveBody, 'ApproveResult');
  expect(approveBody.status).toBe('approved');
  expect(approveBody.gl_entry.balanced).toBe(true);
  expect(approveBody.vendor_exposure).toBe(receivedValue);
  expect(approveBody.vendor_exposure).not.toBe(ORDERED_VALUE);

  const exposureResponse = await request.get(`/vendors/${vendorId}/exposure`);
  expect(exposureResponse.status()).toBe(200);

  const exposure = (await exposureResponse.json()) as VendorExposure;
  await expectSchema(request, exposure, 'VendorExposure');
  expect(exposure.vendor_id).toBe(vendorId);
  expect(exposure.open_ap_liability).toBe(receivedValue);
  expect(exposure.open_ap_liability).not.toBe(ORDERED_VALUE);
  expect(exposure.approved_invoices).toEqual([invoiceId]);
});
