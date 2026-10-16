import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
/** Private notes in the real Shell against simulated onyx-1 reads: Chromium and Firefox, one worker, no retries. */
export default defineConfig({
    testDir: './e2e/os', testMatch: 'os-notes-private.spec.ts', workers: 1, fullyParallel: false, retries: 0, timeout: 120000, expect: { timeout: 20000 }, reporter: 'list', outputDir: 'test-results/notes-private',
    use: { baseURL: 'http://127.0.0.1:6994', screenshot: 'only-on-failure', serviceWorkers: 'block' },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }, { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 1000 } } }],
    webServer: { command: 'node node_modules/.bin/vite --config e2e-notes/private/vite.config.ts --host 127.0.0.1 --port 6994 --strictPort', cwd: fileURLToPath(new URL('.', import.meta.url)), url: 'http://127.0.0.1:6994/e2e-notes/private/index.html', reuseExistingServer: false },
})
