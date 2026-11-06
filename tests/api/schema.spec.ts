import { test, expect } from '@playwright/test';
import { expectSchema } from './helpers/schema';

test('GET /vendors items match Vendor schema', { tag: '@api' }, async ({ request }) => {
  const response = await request.get('/vendors');
  expect(response.status()).toBe(200);

  const vendors: unknown = await response.json();
  expect(Array.isArray(vendors)).toBe(true);

  for (const vendor of vendors as unknown[]) {
    await expectSchema(request, vendor, 'Vendor');
  }
});

test('Vendor without active fails schema check', { tag: '@api' }, async ({ request }) => {
  const response = await request.get('/vendors');
  expect(response.status()).toBe(200);

  const vendors = (await response.json()) as Array<Record<string, unknown>>;
  expect(vendors.length).toBeGreaterThan(0);

  const { active: _active, ...withoutActive } = vendors[0];
  await expect(expectSchema(request, withoutActive, 'Vendor')).rejects.toThrow();
});

test('unknown schema name fails clearly', { tag: '@api' }, async ({ request }) => {
  await expect(expectSchema(request, {}, 'NotARealSchema')).rejects.toThrow();
});
