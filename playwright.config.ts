import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config();

const baseURL = process.env.API_BASE_URL || 'http://localhost:8000';

export default defineConfig({
  testDir: 'tests/api',
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
  },
  webServer: {
    command: 'npm start',
    url: `${baseURL}/health`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'api-setup',
      testMatch: 'reset.setup.ts',
    },
    {
      // Seed-only assertions (exact vendor/SKU counts) must run before other specs create data.
      name: 'api-seed',
      testMatch: 'vendors-and-catalog.spec.ts',
      dependencies: ['api-setup'],
    },
    {
      name: 'api',
      testIgnore: [/reset\.setup\.ts/, /vendors-and-catalog\.spec\.ts/],
      dependencies: ['api-seed'],
    },
  ],
});
