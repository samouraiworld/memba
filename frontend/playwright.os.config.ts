import { defineConfig, devices } from '@playwright/test'

// Memba OS e2e. Two dev servers: one with VITE_MEMBA_OS on (5193), one without
// it (5194) to prove /os stays unreachable while the flag is off.
export const OS_ON = 'http://127.0.0.1:5193'
export const OS_OFF = 'http://127.0.0.1:5194'

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
    ],
})
