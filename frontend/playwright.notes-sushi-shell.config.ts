import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
export default defineConfig({
    testDir: './e2e/os', testMatch: 'os-notes-sushi-shell.spec.ts', workers: 1, retries: 0, timeout: 60000, expect: { timeout: 15000 }, reporter: 'list', outputDir: 'test-results/notes-sushi-shell',
    use: { baseURL: 'http://127.0.0.1:6997', screenshot: 'only-on-failure', serviceWorkers: 'block' },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }, { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 1000 } } }],
    webServer: { command: 'node node_modules/.bin/vite --config e2e-notes/sushi-shell/vite.config.ts --host 127.0.0.1 --port 6997 --strictPort', cwd: fileURLToPath(new URL('.', import.meta.url)), url: 'http://127.0.0.1:6997/e2e-notes/sushi-shell/index.html', reuseExistingServer: false },
})
