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

function lineBySku(po: PurchaseOrder, sku: string): PoLine {
  const line = po.line_items.find((item) => item.sku === sku);
  expect(line).toBeDefined();
  return line!;
}

test('RCV-01 POST /purchase-orders/{poId}/receive full single-line closes PO', { tag: '@api' }, async ({
  request,
}) => {
  // executed — full receive of one line → closed, fully_received
  const po = await createSubmittedPo(request, [{ ...LUM_LINE }]);

  const response = await request.post(`/purchase-orders/${po.id}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 10 }] },
  });
  expect(response.status()).toBe(200);

  const body = (await response.json()) as PurchaseOrder;
  await expectSchema(request, body, 'PurchaseOrder');
  expect(body.id).toBe(po.id);
  expect(body.vendor_id).toBe(po.vendor_id);
  expect(body.status).toBe('closed');
  expect(lineBySku(body, 'LUM-2X4-8').received_quantity).toBe(10);
  expect(body.ordered_value).toBe(47.5);
  expect(body.received_value).toBe(47.5);
  expect(body.fully_received).toBe(true);
});

test('RCV-02 POST /purchase-orders/{poId}/receive partial keeps submitted', { tag: '@api' }, async ({
  request,
}) => {
  // executed — partial delivery on multi-line PO → still submitted
  const po = await createSubmittedPo(request, [{ ...LUM_LINE }, { ...CEM_LINE }]);

  const response = await request.post(`/purchase-orders/${po.id}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 5 }] },
  });
  expect(response.status()).toBe(200);

  const body = (await response.json()) as PurchaseOrder;
  await expectSchema(request, body, 'PurchaseOrder');
  expect(body.status).toBe('submitted');
  expect(lineBySku(body, 'LUM-2X4-8').received_quantity).toBe(5);
  expect(lineBySku(body, 'CEM-30KG').received_quantity).toBe(0);
  expect(body.received_value).toBe(23.75);
  expect(body.fully_received).toBe(false);
});

test('RCV-03 POST /purchase-orders/{poId}/receive accumulates then closes', { tag: '@api' }, async ({
  request,
}) => {
  // executed — second receive completes both lines → closed
  const po = await createSubmittedPo(request, [{ ...LUM_LINE }, { ...CEM_LINE }]);

  const first = await request.post(`/purchase-orders/${po.id}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 5 }] },
  });
  expect(first.status()).toBe(200);
  await expectSchema(request, await first.json(), 'PurchaseOrder');

  const response = await request.post(`/purchase-orders/${po.id}/receive`, {
    data: {
      items: [
        { sku: 'LUM-2X4-8', quantity: 5 },
        { sku: 'CEM-30KG', quantity: 4 },
      ],
    },
  });
  expect(response.status()).toBe(200);

  const body = (await response.json()) as PurchaseOrder;
  await expectSchema(request, body, 'PurchaseOrder');
  expect(lineBySku(body, 'LUM-2X4-8').received_quantity).toBe(10);
  expect(lineBySku(body, 'CEM-30KG').received_quantity).toBe(4);
  expect(body.status).toBe('closed');
  expect(body.received_value).toBe(95.1);
  expect(body.fully_received).toBe(true);
});

test('RCV-04 POST /purchase-orders/{poId}/receive two equal partials close PO', { tag: '@api' }, async ({
  request,
}) => {
  // executed — qty 5 then qty 5 on line of 10 → closed
  const po = await createSubmittedPo(request, [{ ...LUM_LINE }]);

  const firstResponse = await request.post(`/purchase-orders/${po.id}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 5 }] },
  });
  expect(firstResponse.status()).toBe(200);
  const first = (await firstResponse.json()) as PurchaseOrder;
  await expectSchema(request, first, 'PurchaseOrder');
  expect(first.status).toBe('submitted');
  expect(lineBySku(first, 'LUM-2X4-8').received_quantity).toBe(5);
  expect(first.fully_received).toBe(false);

  const secondResponse = await request.post(`/purchase-orders/${po.id}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 5 }] },
  });
  expect(secondResponse.status()).toBe(200);
  const second = (await secondResponse.json()) as PurchaseOrder;
  await expectSchema(request, second, 'PurchaseOrder');
  expect(second.status).toBe('closed');
  expect(lineBySku(second, 'LUM-2X4-8').received_quantity).toBe(10);
  expect(second.fully_received).toBe(true);
  expect(second.received_value).toBe(second.ordered_value);
});

test('RCV-05 POST /purchase-orders/{poId}/receive only second line full qty', { tag: '@api' }, async ({
  request,
}) => {
  // executed — receive CEM only → LUM still 0, not closed
  const po = await createSubmittedPo(request, [{ ...LUM_LINE }, { ...CEM_LINE }]);

  const response = await request.post(`/purchase-orders/${po.id}/receive`, {
    data: { items: [{ sku: 'CEM-30KG', quantity: 4 }] },
  });
  expect(response.status()).toBe(200);

  const body = (await response.json()) as PurchaseOrder;
  await expectSchema(request, body, 'PurchaseOrder');
  expect(body.status).toBe('submitted');
  expect(lineBySku(body, 'CEM-30KG').received_quantity).toBe(4);
  expect(lineBySku(body, 'LUM-2X4-8').received_quantity).toBe(0);
  expect(body.fully_received).toBe(false);
  expect(body.received_value).toBe(47.6);
});

test('RCV-06 POST /purchase-orders/{poId}/receive quantity 1 smallest valid', { tag: '@api' }, async ({
  request,
}) => {
  // executed — quantity:1 exclusiveMinimum boundary
  const po = await createSubmittedPo(request, [{ ...LUM_LINE }]);

  const response = await request.post(`/purchase-orders/${po.id}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 1 }] },
  });
  expect(response.status()).toBe(200);

  const body = (await response.json()) as PurchaseOrder;
  await expectSchema(request, body, 'PurchaseOrder');
  expect(lineBySku(body, 'LUM-2X4-8').received_quantity).toBe(1);
  expect(body.status).toBe('submitted');
  expect(body.fully_received).toBe(false);
  expect(body.received_value).toBe(1 * 4.75);
});

test('RCV-07 POST /purchase-orders/{poId}/receive quantity at schema maximum 10000', { tag: '@api' }, async ({
  request,
}) => {
  // executed — receive quantity:10000 full line → closed
  const po = await createSubmittedPo(request, [
    { sku: 'LUM-2X4-8', quantity: 10000, unit_price: 1 },
  ]);

  const response = await request.post(`/purchase-orders/${po.id}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 10000 }] },
  });
  expect(response.status()).toBe(200);

  const body = (await response.json()) as PurchaseOrder;
  await expectSchema(request, body, 'PurchaseOrder');
  expect(lineBySku(body, 'LUM-2X4-8').received_quantity).toBe(10000);
  expect(body.status).toBe('closed');
  expect(body.fully_received).toBe(true);
  expect(body.received_value).toBe(10000);
});

test('RCV-08 POST /purchase-orders/{poId}/receive unknown poId returns 404', { tag: '@api' }, async ({
  request,
}) => {
  // executed — unknown poId → 404, no rule
  const response = await request.post('/purchase-orders/po-does-not-exist/receive', {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 1 }] },
  });
  expect(response.status()).toBe(404);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBeUndefined();
});

test('RCV-09 POST /purchase-orders/{poId}/receive on draft returns workflow_gate', { tag: '@api' }, async ({
  request,
}) => {
  // executed — receive on draft (not submitted) → 400 workflow_gate
  const draft = await createDraftPo(request, [{ ...LUM_LINE }]);

  const response = await request.post(`/purchase-orders/${draft.id}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 10 }] },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('workflow_gate');
});

test('RCV-10 POST /purchase-orders/{poId}/receive over ordered returns receive_quantity_limit', { tag: '@api' }, async ({
  request,
}) => {
  // executed — quantity 11 on ordered 10 → 400 receive_quantity_limit
  const po = await createSubmittedPo(request, [{ ...LUM_LINE }]);

  const response = await request.post(`/purchase-orders/${po.id}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 11 }] },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('receive_quantity_limit');
});

test('RCV-11 POST /purchase-orders/{poId}/receive cumulative over ordered returns receive_quantity_limit', { tag: '@api' }, async ({
  request,
}) => {
  // executed — 6 then 5 (cumulative 11) → second call receive_quantity_limit
  const po = await createSubmittedPo(request, [{ ...LUM_LINE }]);

  const firstResponse = await request.post(`/purchase-orders/${po.id}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 6 }] },
  });
  expect(firstResponse.status()).toBe(200);
  const first = (await firstResponse.json()) as PurchaseOrder;
  await expectSchema(request, first, 'PurchaseOrder');
  expect(lineBySku(first, 'LUM-2X4-8').received_quantity).toBe(6);

  const response = await request.post(`/purchase-orders/${po.id}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 5 }] },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('receive_quantity_limit');
});

test('RCV-13 POST /purchase-orders/{poId}/receive missing items returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — {} missing items → 400 validation_error
  const po = await createSubmittedPo(request);

  const response = await request.post(`/purchase-orders/${po.id}/receive`, {
    data: {},
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('RCV-14 POST /purchase-orders/{poId}/receive empty items returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — items:[] → 400 validation_error
  const po = await createSubmittedPo(request);

  const response = await request.post(`/purchase-orders/${po.id}/receive`, {
    data: { items: [] },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('RCV-15 POST /purchase-orders/{poId}/receive missing sku returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — item missing sku → 400 validation_error
  const po = await createSubmittedPo(request);

  const response = await request.post(`/purchase-orders/${po.id}/receive`, {
    data: { items: [{ quantity: 1 }] },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('RCV-16 POST /purchase-orders/{poId}/receive missing quantity returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — item missing quantity → 400 validation_error
  const po = await createSubmittedPo(request);

  const response = await request.post(`/purchase-orders/${po.id}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8' }] },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('RCV-17 POST /purchase-orders/{poId}/receive empty sku returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — sku:"" → 400 validation_error
  const po = await createSubmittedPo(request);

  const response = await request.post(`/purchase-orders/${po.id}/receive`, {
    data: { items: [{ sku: '', quantity: 1 }] },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('RCV-18 POST /purchase-orders/{poId}/receive quantity 0 returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — quantity:0 → 400 validation_error
  const po = await createSubmittedPo(request);

  const response = await request.post(`/purchase-orders/${po.id}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 0 }] },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('RCV-19 POST /purchase-orders/{poId}/receive quantity -1 returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — quantity:-1 → 400 validation_error
  const po = await createSubmittedPo(request);

  const response = await request.post(`/purchase-orders/${po.id}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: -1 }] },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('RCV-20 POST /purchase-orders/{poId}/receive quantity 10001 returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — quantity:10001 → 400 validation_error
  const po = await createSubmittedPo(request);

  const response = await request.post(`/purchase-orders/${po.id}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 10001 }] },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('RCV-21 POST /purchase-orders/{poId}/receive quantity as string returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — quantity:"10" wrong type → 400 validation_error
  const po = await createSubmittedPo(request);

  const response = await request.post(`/purchase-orders/${po.id}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: '10' }] },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('RCV-22 POST /purchase-orders/{poId}/receive SKU not on PO returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — CEM on LUM-only PO → 400 validation_error
  const po = await createSubmittedPo(request, [{ ...LUM_LINE }]);

  const response = await request.post(`/purchase-orders/${po.id}/receive`, {
    data: { items: [{ sku: 'CEM-30KG', quantity: 1 }] },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});
