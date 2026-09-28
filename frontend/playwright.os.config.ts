import { defineConfig, devices } from '@playwright/test'

// Memba OS e2e. The standard OS servers prove the on/off gate; a separate
// Feed-enabled server exercises Feed flows without changing other OS tests.
const ON_PORT = Number(process.env.MEMBA_OS_ON_TEST_PORT) || 5193
const OFF_PORT = Number(process.env.MEMBA_OS_OFF_TEST_PORT) || 5194
export const OS_ON = `http://127.0.0.1:${ON_PORT}`
export const OS_OFF = `http://127.0.0.1:${OFF_PORT}`
// Parallel worktrees can reserve 5196 for another OS run without changing the
// default fixture. The exported URL and server command must move together.
const FEED_PORT = Number(process.env.MEMBA_OS_FEED_TEST_PORT) || 5196
export const OS_FEED_ON = `http://127.0.0.1:${FEED_PORT}`

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
            command: `npm run dev -- --host 127.0.0.1 --port ${ON_PORT} --strictPort`,
            env: { VITE_MEMBA_OS: 'true' },
            url: OS_ON, reuseExistingServer: false, timeout: 120_000,
        },
        {
            command: `npm run dev -- --host 127.0.0.1 --port ${OFF_PORT} --strictPort`,
            env: { VITE_MEMBA_OS: 'false' },
            url: OS_OFF, reuseExistingServer: false, timeout: 120_000,
        },
        {
            command: `npm run dev -- --host 127.0.0.1 --port ${FEED_PORT} --strictPort`,
            env: { VITE_MEMBA_OS: 'true', VITE_ENABLE_FEED: 'true' },
            url: OS_FEED_ON, reuseExistingServer: false, timeout: 120_000,
        },
    ],
})
