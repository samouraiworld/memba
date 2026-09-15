import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
    fullyParallel: true, testDir: './e2e', testMatch: 'complete-design.spec.ts', timeout: 60_000,
    expect: { timeout: 12_000 }, workers: 2, reporter: 'list', outputDir: 'test-results-complete',
    use: { baseURL: 'http://127.0.0.1:5201', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] }, grep: /interaction/ },
        { name: 'iphone', use: { ...devices['iPhone 13'] }, grep: /interaction/ },
    ],
    webServer: {
        command: 'npm run dev -- --host 127.0.0.1 --port 5201 --strictPort',
        env: { VITE_ENABLE_PRO_APP: 'true' },
        url: 'http://127.0.0.1:5201', reuseExistingServer: false, timeout: 120_000,
    },
})
