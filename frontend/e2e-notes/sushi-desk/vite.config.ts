import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { parseChangelogMarkdown } from '../../src/lib/changelog'
const fixture = (file: string) => fileURLToPath(new URL(`./${file}`, import.meta.url))
export default defineConfig({
    plugins: [react(), { name: 'fixture-real-changelog', resolveId: id => id === 'virtual:memba-changelog' ? '\0virtual:memba-changelog' : undefined, load: id => id === '\0virtual:memba-changelog' ? `export default ${JSON.stringify(parseChangelogMarkdown(readFileSync(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8')))}` : undefined }],
    cacheDir: 'node_modules/.vite-notes-sushi-desk', define: { __APP_VERSION__: JSON.stringify('notes-shell-test'), 'import.meta.env.VITE_ENABLE_NOTES': JSON.stringify('true'), 'import.meta.env.VITE_MEMBA_OS': JSON.stringify('true'), 'import.meta.env.VITE_ENABLE_EVM': JSON.stringify('false') },
    resolve: { alias: [
        { find: /.*\/lib\/notes\/featuredNoteRelease$/, replacement: fixture('releases.ts') },
        { find: /.*\/shell\/useOsSession$/, replacement: fixture('session.tsx') }, { find: './useOsSession', replacement: fixture('session.tsx') },
        { find: /.*\/lib\/notes\/config$/, replacement: fixture('notes-config.ts') },
        { find: /.*\/lib\/notes\/chain\/client$/, replacement: fixture('client.ts') },
    ] },
    optimizeDeps: { entries: ['e2e-notes/sushi-desk/index.html'], include: ['marked', 'marked-footnote', 'dompurify'] },
})
