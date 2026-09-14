import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
    testDir: './e2e', testMatch: 'governance-pro.spec.ts', timeout: 60_000,
    expect: { timeout: 15_000 }, workers: 2, reporter: 'list', outputDir: 'test-results-governance',
    use: { baseURL: 'http://127.0.0.1:5195', screenshot: 'only-on-failure' },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        { name: 'iphone', use: { ...devices['iPhone 13'] }, grep: /mobile/ },
        { name: 'pixel', use: { ...devices['Pixel 5'] }, grep: /mobile/ },
    ],
    webServer: {
        command: 'npm run dev -- --host 127.0.0.1 --port 5195 --strictPort',
        env: { VITE_ENABLE_PRO_UI: 'true', VITE_ENABLE_PRO_SHELL: 'true', VITE_ENABLE_PRO_GOVERNANCE: 'true' },
        url: 'http://127.0.0.1:5195', reuseExistingServer: false, timeout: 120_000,
    },
})
