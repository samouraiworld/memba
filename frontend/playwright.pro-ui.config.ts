import { defineConfig, devices } from '@playwright/test'
/** Isolated preview lane; never changes production flags or shared dev ports. */
export default defineConfig({
    testDir: './e2e', testMatch: 'validators-pro.spec.ts',
    timeout: 60_000, expect: { timeout: 15_000 }, workers: 2, reporter: 'list',
    use: { baseURL: 'http://127.0.0.1:5189', screenshot: 'only-on-failure' },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        { name: 'iphone', use: { ...devices['iPhone 13'] }, grep: /fits at (390|320)px|mobile health filter/ },
        { name: 'pixel', use: { ...devices['Pixel 5'] }, grep: /fits at (390|320)px|mobile health filter/ },
    ],
    webServer: {
        command: 'npm run dev -- --host 127.0.0.1 --port 5189 --strictPort',
        env: { VITE_ENABLE_PRO_UI: 'true' },
        url: 'http://127.0.0.1:5189', reuseExistingServer: false, timeout: 120_000,
    },
})
