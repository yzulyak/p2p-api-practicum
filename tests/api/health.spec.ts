import { test, expect } from '@playwright/test';

test('GET /health returns ok', { tag: '@api' }, async ({ request }) => {
  const response = await request.get('/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
});
