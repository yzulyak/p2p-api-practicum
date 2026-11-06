import { test, expect } from '@playwright/test';
import { expectSchema } from './helpers/schema';

const SEED_VENDORS = [
  { id: 'vnd-001', name: 'Maple Ridge Supply', active: true },
  { id: 'vnd-002', name: 'Old Quarry Materials', active: false },
] as const;

const SEED_SKUS = [
  { sku: 'LUM-2X4-8', description: '2x4 stud, 8 ft', unit_price: 4.75 },
  { sku: 'PLY-12-4X8', description: 'Plywood sheet, 1/2 in, 4x8 ft', unit_price: 22.4 },
  { sku: 'CEM-30KG', description: 'Cement bag, 30 kg', unit_price: 11.9 },
  { sku: 'REB-10MM-6', description: 'Rebar, 10 mm, 6 m', unit_price: 18.25 },
  { sku: 'SCR-DECK-1LB', description: 'Deck screws, 1 lb box', unit_price: 9.99 },
] as const;

test.describe.configure({ mode: 'serial' });

test('V-G-01 GET /vendors after seed returns the two seed vendors', { tag: '@api' }, async ({
  request,
}) => {
  // executed — GET /vendors returns seed pair after api-setup reset
  const response = await request.get('/vendors');
  expect(response.status()).toBe(200);

  const vendors = (await response.json()) as unknown[];
  expect(vendors).toHaveLength(2);

  for (const vendor of vendors) {
    await expectSchema(request, vendor, 'Vendor');
  }

  expect(vendors).toEqual(expect.arrayContaining([...SEED_VENDORS]));
  for (const seed of SEED_VENDORS) {
    expect(vendors).toContainEqual(seed);
  }
});

test('V-G-02 GET /vendors includes a newly created vendor', { tag: '@api' }, async ({
  request,
}) => {
  // executed — created vendor appears in GET /vendors list
  const createResponse = await request.post('/vendors', {
    data: { name: 'Cedar Point Hardware' },
  });
  expect(createResponse.status()).toBe(201);
  const created = await createResponse.json();
  await expectSchema(request, created, 'Vendor');

  const response = await request.get('/vendors');
  expect(response.status()).toBe(200);

  const vendors = (await response.json()) as Array<{
    id: string;
    name: string;
    active: boolean;
  }>;
  expect(vendors).toHaveLength(3);

  for (const vendor of vendors) {
    await expectSchema(request, vendor, 'Vendor');
  }

  expect(vendors).toEqual(expect.arrayContaining([...SEED_VENDORS]));
  const cedar = vendors.find((v) => v.name === 'Cedar Point Hardware');
  expect(cedar).toBeDefined();
  expect(cedar!.active).toBe(true);
  expect(cedar!.id.startsWith('vnd-')).toBe(true);
});

test('V-P-01 POST /vendors with name only creates active vendor', { tag: '@api' }, async ({
  request,
}) => {
  // executed — POST /vendors defaults active to true
  const response = await request.post('/vendors', {
    data: { name: 'Cedar Point Hardware' },
  });
  expect(response.status()).toBe(201);

  const body = await response.json();
  await expectSchema(request, body, 'Vendor');
  expect(body.name).toBe('Cedar Point Hardware');
  expect(body.active).toBe(true);
  expect(body.id.startsWith('vnd-')).toBe(true);
});

test('V-P-02 POST /vendors with active true', { tag: '@api' }, async ({ request }) => {
  // executed — POST /vendors with active:true
  const response = await request.post('/vendors', {
    data: { name: 'Active Co', active: true },
  });
  expect(response.status()).toBe(201);

  const body = await response.json();
  await expectSchema(request, body, 'Vendor');
  expect(body.name).toBe('Active Co');
  expect(body.active).toBe(true);
  expect(body.id.startsWith('vnd-')).toBe(true);
});

test('V-P-03 POST /vendors with active false', { tag: '@api' }, async ({ request }) => {
  // executed — POST /vendors with active:false
  const response = await request.post('/vendors', {
    data: { name: 'Inactive Co', active: false },
  });
  expect(response.status()).toBe(201);

  const body = await response.json();
  await expectSchema(request, body, 'Vendor');
  expect(body.name).toBe('Inactive Co');
  expect(body.active).toBe(false);
  expect(body.id.startsWith('vnd-')).toBe(true);
});

test('V-P-04 POST /vendors with shortest non-empty name', { tag: '@api' }, async ({
  request,
}) => {
  // executed — POST /vendors name minLength boundary "A"
  const response = await request.post('/vendors', {
    data: { name: 'A' },
  });
  expect(response.status()).toBe(201);

  const body = await response.json();
  await expectSchema(request, body, 'Vendor');
  expect(body.name).toBe('A');
  expect(body.active).toBe(true);
  expect(body.id.startsWith('vnd-')).toBe(true);
});

test('V-P-05 POST /vendors missing name returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — POST /vendors {} → 400 validation_error
  const response = await request.post('/vendors', {
    data: {},
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('V-P-06 POST /vendors empty name returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — POST /vendors name:"" → 400 validation_error
  const response = await request.post('/vendors', {
    data: { name: '' },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('V-P-07 POST /vendors name wrong type returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — POST /vendors name:123 → 400 validation_error
  const response = await request.post('/vendors', {
    data: { name: 123 },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('V-P-08 POST /vendors active wrong type returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — POST /vendors active:"yes" → 400 validation_error
  const response = await request.post('/vendors', {
    data: { name: 'Ok', active: 'yes' },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('V-P-09 POST /vendors name null returns validation_error', { tag: '@api' }, async ({
  request,
}) => {
  // executed — POST /vendors name:null → 400 validation_error
  const response = await request.post('/vendors', {
    data: { name: null },
  });
  expect(response.status()).toBe(400);

  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body.rule).toBe('validation_error');
});

test('S-G-01 GET /skus after seed returns the five catalog SKUs', { tag: '@api' }, async ({
  request,
}) => {
  // executed — GET /skus returns five seed catalog entries
  const response = await request.get('/skus');
  expect(response.status()).toBe(200);

  const skus = (await response.json()) as unknown[];
  expect(skus).toHaveLength(5);

  for (const sku of skus) {
    await expectSchema(request, sku, 'Sku');
  }

  for (const seed of SEED_SKUS) {
    expect(skus).toContainEqual(seed);
  }
});

test('S-G-02 GET /skus unchanged after unrelated vendor create', { tag: '@api' }, async ({
  request,
}) => {
  // executed — catalog stable after POST /vendors
  const createResponse = await request.post('/vendors', {
    data: { name: `Catalog-Stability-${Date.now()}` },
  });
  expect(createResponse.status()).toBe(201);
  await expectSchema(request, await createResponse.json(), 'Vendor');

  const response = await request.get('/skus');
  expect(response.status()).toBe(200);

  const skus = (await response.json()) as unknown[];
  expect(skus).toHaveLength(5);

  for (const sku of skus) {
    await expectSchema(request, sku, 'Sku');
  }

  for (const seed of SEED_SKUS) {
    expect(skus).toContainEqual(seed);
  }
});
