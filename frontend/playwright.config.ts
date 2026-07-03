import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    // 2 workers in CI (matches the 2-vCPU ubuntu runner). The
    // deterministic specs run fully parallel; the live-RPC specs (validators,
    // dao, directory, gnolove*) opt into serial mode per-file so a single file
    // never splits its on-chain reads across both workers and double-loads the
    // public test13 RPC / gnolove API.
    // History: this was dropped to 1 because first-attempt pass-rate regressed.
    // Root cause (found 2026-07-03, not worker-count itself): NetworkSync fired
    // window.location.reload() on EVERY fresh browser context (stored network
    // null ≠ URL network), so each test raced a mid-page reload; contention at
    // 2 workers made the race land mid-test far more often (firefox cmd-k was
    // the visible casualty). Fixed in NetworkSync (reload only on a REAL network
    // change); restored to 2 after 2× full-suite workers=2 local runs at 0
    // unexpected failures.
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
    webServer: [
        {
            command: 'npm run dev',
            url: 'http://localhost:5173',
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
        },
        // Second dev server with PINNED feature flags: `vite --mode e2e` loads the
        // committed root .env.e2e, whose values override the (gitignored, per-machine)
        // .env. Only marketplace-gating.spec.ts targets it (test.use baseURL :5174) —
        // its live-vs-gated lane expectations must hold regardless of what
        // VITE_ENABLE_* happens to be in the local .env or absent in CI.
        {
            command: 'npm run dev:e2e',
            url: 'http://localhost:5174',
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
        },
    ],
})

