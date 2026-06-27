import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    // 2 parallel workers in CI (matches the 2-vCPU ubuntu runner). The
    // deterministic specs run fully parallel; the live-RPC specs (validators,
    // dao, directory, gnolove*) opt into serial mode per-file so a single file
    // never splits its on-chain reads across both workers and double-loads the
    // public test13 RPC / gnolove API. Was 1 (fully serialized) — the dominant
    // ~12min E2E cost. Drop back to 1 if first-attempt pass-rate regresses >5pp.
    workers: process.env.CI ? 2 : undefined,
    reporter: process.env.CI ? 'list' : 'html',
    timeout: 45_000,
    expect: {
        timeout: 10_000,
    },
    use: {
        baseURL: 'http://localhost:5173',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'on-first-retry',
        actionTimeout: process.env.CI ? 10_000 : 5_000,
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /\.mobile\.spec\.ts$/ },
        { name: 'firefox',  use: { ...devices['Desktop Firefox'] }, testIgnore: /\.mobile\.spec\.ts$/ },
        { name: 'iphone',   use: { ...devices['iPhone 13'] },  testMatch: /\.mobile\.spec\.ts$/ },
        { name: 'pixel',    use: { ...devices['Pixel 5'] },    testMatch: /\.mobile\.spec\.ts$/ },
    ],
    webServer: {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
    },
})

