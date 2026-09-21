import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
    testDir: './e2e/release', workers: 1, fullyParallel: false, retries: 0,
    timeout: 60_000, expect: { timeout: 15_000 }, reporter: 'list',
    outputDir: 'test-results-release',
    use: { baseURL: 'http://127.0.0.1:5211', serviceWorkers: 'allow', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: { command: 'node scripts/serve-release-fixtures.mjs', url: 'http://127.0.0.1:5211/mainnet', reuseExistingServer: false },
})
