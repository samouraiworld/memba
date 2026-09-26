import { defineConfig, devices } from '@playwright/test'

// Memba OS e2e. The standard OS servers prove the on/off gate; a separate
// Feed-enabled server exercises Feed flows without changing other OS tests.
export const OS_ON = 'http://127.0.0.1:5193'
export const OS_OFF = 'http://127.0.0.1:5194'
export const OS_FEED_ON = 'http://127.0.0.1:5196'

export default defineConfig({
    testDir: './e2e/os',
    timeout: 60_000, expect: { timeout: 15_000 }, workers: 2, reporter: 'list',
    outputDir: 'test-results-os',
    use: { screenshot: 'only-on-failure' },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    ],
    webServer: [
        {
            command: 'npm run dev -- --host 127.0.0.1 --port 5193 --strictPort',
            env: { VITE_MEMBA_OS: 'true' },
            url: OS_ON, reuseExistingServer: false, timeout: 120_000,
        },
        {
            command: 'npm run dev -- --host 127.0.0.1 --port 5194 --strictPort',
            env: { VITE_MEMBA_OS: 'false' },
            url: OS_OFF, reuseExistingServer: false, timeout: 120_000,
        },
        {
            command: 'npm run dev -- --host 127.0.0.1 --port 5196 --strictPort',
            env: { VITE_MEMBA_OS: 'true', VITE_ENABLE_FEED: 'true' },
            url: OS_FEED_ON, reuseExistingServer: false, timeout: 120_000,
        },
    ],
})
