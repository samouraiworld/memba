import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
export default defineConfig({
    testDir: './e2e/os', testMatch: 'os-notes-sushi-public.spec.ts', workers: 1, retries: 0, timeout: 45000, expect: { timeout: 10000 }, reporter: 'list', outputDir: 'test-results/notes-sushi',
    use: { baseURL: 'http://127.0.0.1:6996', screenshot: 'only-on-failure', serviceWorkers: 'block' },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }, { name: 'firefox', use: { ...devices['Desktop Firefox'] } }],
    webServer: { command: 'node node_modules/.bin/vite --config e2e-notes/sushi/vite.config.ts --host 127.0.0.1 --port 6996 --strictPort', cwd: fileURLToPath(new URL('.', import.meta.url)), url: 'http://127.0.0.1:6996/e2e-notes/sushi/index.html', reuseExistingServer: false },
})
