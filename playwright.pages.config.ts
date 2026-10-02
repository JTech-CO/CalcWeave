import { defineConfig } from '@playwright/test';
import rootConfig from './playwright.config';

export default defineConfig({
  ...rootConfig,
  testMatch: '**/pages-subpath.spec.ts', testIgnore: [],
  use: { ...rootConfig.use, baseURL: 'http://127.0.0.1:4174/CalcWeave/' },
  webServer: {
    command: 'npm run preview -- --port 4174', url: 'http://127.0.0.1:4174/CalcWeave/',
    env: { CALCWEAVE_BASE_PATH: '/CalcWeave/' }, reuseExistingServer: !process.env.CI, timeout: 20_000,
  },
});
