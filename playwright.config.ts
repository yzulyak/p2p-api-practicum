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
      name: 'api',
      dependencies: ['api-setup'],
    },
  ],
});
