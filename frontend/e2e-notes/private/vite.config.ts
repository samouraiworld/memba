import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { parseChangelogMarkdown } from '../../src/lib/changelog'
const fixture = (file: string) => fileURLToPath(new URL(`./${file}`, import.meta.url))
/**
 * DEV ONLY, never a production or preview build: the private-notes switches are defined for this dev server alone
 * (the production bundle gate, check:bundle:notes-private, builds without them). The real config, gate and
 * network allowlist decide: onyx-1 opens private notes.
 */
export default defineConfig({
    plugins: [react(), { name: 'fixture-real-changelog', resolveId: id => id === 'virtual:memba-changelog' ? '\0virtual:memba-changelog' : undefined, load: id => id === '\0virtual:memba-changelog' ? `export default ${JSON.stringify(parseChangelogMarkdown(readFileSync(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8')))}` : undefined }],
    cacheDir: 'node_modules/.vite-notes-private',
    define: { __APP_VERSION__: JSON.stringify('notes-private-test'), 'import.meta.env.VITE_MEMBA_OS': JSON.stringify('true'), 'import.meta.env.VITE_ENABLE_EVM': JSON.stringify('false'),
        'import.meta.env.VITE_ENABLE_NOTES': JSON.stringify('true'), 'import.meta.env.VITE_ENABLE_NOTES_CHAIN': JSON.stringify('true'), 'import.meta.env.VITE_ENABLE_NOTES_ENCRYPTED': JSON.stringify('true') },
    resolve: { alias: [
        { find: /.*\/lib\/notes\/featuredNoteRelease$/, replacement: fixture('releases.ts') },
        { find: /.*\/shell\/useOsSession$/, replacement: fixture('session.tsx') }, { find: './useOsSession', replacement: fixture('session.tsx') },
        { find: /.*\/lib\/notes\/chain\/client$/, replacement: fixture('client.ts') },
    ] },
    optimizeDeps: { entries: ['e2e-notes/private/index.html'], include: ['marked', 'marked-footnote', 'dompurify']},
})
