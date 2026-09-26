import { readFileSync, mkdtempSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { osIdentityAllowed, osSiteHtml, osManifest, OS_BRAND_FILES } from './osSiteIdentity'

const source = readFileSync('index.html', 'utf8')
const brand = resolve('src/os/brand')

describe('beta identity', () => {
    it.each([
        [{}, false], [{ VITE_MEMBA_OS: 'true' }, false], [{ MEMBA_OS_BETA_SITE: 'true' }, false],
        [{ VITE_MEMBA_OS: 'false', MEMBA_OS_BETA_SITE: 'true' }, false],
        [{ VITE_MEMBA_OS: 'true', MEMBA_OS_BETA_SITE: 'true' }, true],
    ])('requires both explicit flags: %j', (env, expected) => expect(osIdentityAllowed(env)).toBe(expected))

    it('replaces identity without changing security, analytics or the body', () => {
        const html = osSiteHtml(source)
        const doc = new DOMParser().parseFromString(html, 'text/html')
        const original = new DOMParser().parseFromString(source, 'text/html')
        expect(doc.title).toBe('Memba OS — A home for gno.land.')
        expect(doc.querySelectorAll('title')).toHaveLength(1)
        expect(doc.querySelectorAll('[property="og:image"]')).toHaveLength(1)
        expect(doc.querySelector('[property="og:image"]')?.getAttribute('content')).toBe('https://memba.club/brand/os/share-1200x630.png')
        expect(doc.querySelector('[property="og:image:width"]')?.getAttribute('content')).toBe('1200')
        expect(doc.querySelector('[property="og:image:height"]')?.getAttribute('content')).toBe('630')
        expect(doc.querySelector('[name="twitter:site"]')?.getAttribute('content')).toBe('@samouraicoop')
        expect(doc.querySelector('[http-equiv="Content-Security-Policy"]')?.outerHTML).toBe(original.querySelector('[http-equiv="Content-Security-Policy"]')?.outerHTML)
        expect([...doc.scripts].filter(s => s.type !== 'application/ld+json').map(s => s.outerHTML)).toEqual([...original.scripts].filter(s => s.type !== 'application/ld+json').map(s => s.outerHTML))
        expect(doc.body.innerHTML).toBe(original.body.innerHTML)
        expect(html).not.toContain('memba.samourai.app')
        expect(html).not.toContain('/brand/folded-m/')
        expect(html).not.toContain('share-1200x1200')
        expect(osManifest.start_url).toBe('/os')
        expect(osManifest.icons.every(icon => icon.src.startsWith('/brand/os/'))).toBe(true)
        for (const f of OS_BRAND_FILES) expect(readFileSync(resolve(brand, f)).length).toBeGreaterThan(0)
    })

    it.each([
        ['share-1200x630.png', 1200, 630], ['share-1200x1200.png', 1200, 1200],
        ['icon-192.png', 192, 192], ['icon-512.png', 512, 512], ['maskable-512.png', 512, 512],
        ['apple-touch-icon-180.png', 180, 180], ['favicon-16.png', 16, 16], ['favicon-32.png', 32, 32],
    ])('preserves approved asset dimensions: %s', (name, width, height) => {
        const bytes = readFileSync(resolve(brand, name))
        expect(bytes.subarray(1, 4).toString()).toBe('PNG')
        expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([width, height])
        expect(bytes.length).toBeLessThan(600 * 1024)
    })

    it('rejects filenames, renamed artwork and inline brand contents in flag-off artifacts', () => {
        const dir = mkdtempSync(resolve(tmpdir(), 'beta-brand-gate-'))
        const scan = () => spawnSync(process.execPath, ['scripts/check-os-chunk.mjs', dir], { encoding: 'utf8' })
        try {
            writeFileSync(resolve(dir, 'index.html'), source)
            expect(scan().status).toBe(0)
            for (const [file, bytes] of [
                ['share-1200x630.png', Buffer.from('filename-only')],
                ['renamed.png', readFileSync(resolve(brand, 'icon-192.png'))],
                ['inline.css', Buffer.from(`url(data:image/png;base64,${readFileSync(resolve(brand, 'favicon-16.png')).toString('base64')})`)],
                ['reference.json', Buffer.from('{"icon":"/brand/os/favicon.svg"}')],
                ['inline.html', readFileSync(resolve(brand, 'favicon.svg'))],
            ] as const) {
                writeFileSync(resolve(dir, file), bytes)
                expect(scan().status, file).toBe(1)
                rmSync(resolve(dir, file))
            }
            copyFileSync('public/icons/icon-192.png', resolve(dir, 'icon-192.png'))
            expect(scan().status).toBe(0)
        } finally { rmSync(dir, { recursive: true, force: true }) }
    })
})
