import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.MEMBA_GNOTIF_TEST_PORT) || 5212
const baseURL = `http://127.0.0.1:${port}`
// Real PWA registrations need a production build; dev OS servers do not emit sw.js.
export default defineConfig({
    testDir: './e2e/labs', testMatch: 'gnotif.spec.ts', workers: 1, retries: 0,
    timeout: 60000, expect: { timeout: 15000 }, reporter: 'list',
    outputDir: 'test-results/gnotif',
    use: { baseURL, serviceWorkers: 'allow', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
        env: { MEMBA_OS_BETA_SITE: 'true', VITE_MEMBA_OS: 'true', VITE_ENABLE_GNOTIF_LAB: 'true' },
        url: baseURL, reuseExistingServer: false, timeout: 180000,
    },
})
