import { test as setup, expect } from '@playwright/test';

setup('reset API to seed state', async ({ request }) => {
  const response = await request.post('/admin/reset');
  expect(response.status()).toBe(200);
});
