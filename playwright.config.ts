import { defineConfig } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Reuse an already installed browser; no runtime download on a test invocation.
const cache = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const candidates = existsSync(cache) ? readdirSync(cache).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])) : [];
const cachedBrowser = candidates.map(name => join(cache, name, 'chrome-win64', 'chrome.exe')).find(existsSync);
export default defineConfig({
  testDir: './tests/e2e', timeout: 30_000, fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath: process.env.CALCWEAVE_BROWSER_PATH ?? cachedBrowser },
    trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'npm run preview', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI, timeout: 20_000 },
});
