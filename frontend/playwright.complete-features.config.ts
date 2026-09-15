import { defineConfig } from '@playwright/test'
import base from './playwright.complete.config'
export default defineConfig({
    ...base, outputDir: 'test-results-complete-features',
    use: { ...base.use, baseURL: 'http://127.0.0.1:5202' },
    webServer: {
        command: 'npm run dev -- --host 127.0.0.1 --port 5202 --strictPort',
        // Browser fixture server only. No release config or capability policy changes.
        env: { VITE_ENABLE_PRO_APP: 'true', VITE_ENABLE_APPSTORE: 'true', VITE_ENABLE_APPSTORE_SUBMIT: 'true',
            VITE_ENABLE_FEED: 'true', VITE_ENABLE_NFT: 'true', VITE_ENABLE_MARKETPLACE: 'true',
            VITE_ENABLE_MARKETPLACE_V2: 'true', VITE_ENABLE_SERVICES: 'true', VITE_ENABLE_AGENTS: 'true',
            VITE_ENABLE_GAME: 'true', VITE_ENABLE_SPACE_INVADERS: 'true', VITE_ENABLE_BARRICADE: 'true' },
        url: 'http://127.0.0.1:5202', reuseExistingServer: false, timeout: 120_000,
    },
})
