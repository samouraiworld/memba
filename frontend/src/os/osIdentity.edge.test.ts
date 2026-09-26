import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import handler from '../../netlify/edge-functions/os-identity'
import { osSiteHtml } from './osSiteIdentity'

const classic = readFileSync('index.html', 'utf8')
const beta = osSiteHtml(classic)
const page = (body = beta, status = 200, type = 'text/html') => new Response(body, { status, headers: {
    'content-type': type, 'content-security-policy': "default-src 'self'", etag: 'old', 'content-length': '1', 'cache-control': 'public, max-age=3600',
} })

describe('beta HTTP metadata', () => {
    it.each(['/os', '/os/', '/os/nft', '/os/settings', '/os/dao/gno.land/r/demo/a', '/os/test%22%3E&x', '/os/$&'])('returns the served path for browsers and crawlers: %s', async path => {
        for (const agent of ['Mozilla/5.0', 'Twitterbot/1.0']) {
            const result = await handler(new Request(`https://memba.club${path}?tracking=ignored`, { headers: { 'user-agent': agent } }), { next: async () => page() })
            const doc = new DOMParser().parseFromString(await result.text(), 'text/html')
            expect(doc.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`https://memba.club${path}`)
            expect(doc.querySelector('[property="og:url"]')?.getAttribute('content')).toBe(`https://memba.club${path}`)
            expect(result.headers.get('content-security-policy')).toBe("default-src 'self'")
            expect(result.headers.has('etag')).toBe(false)
            expect(result.headers.has('content-length')).toBe(false)
            expect(result.headers.get('cache-control')).toBe('private, no-cache')
        }
    })
    it.each([
        ['https://memba.samourai.app/os/nft', beta, 200, 'text/html', 'GET'],
        ['https://memba.club.evil.test/os', beta, 200, 'text/html', 'GET'],
        ['https://preview.netlify.app/os', beta, 200, 'text/html', 'GET'],
        ['https://memba.club/os', classic, 200, 'text/html', 'GET'],
        ['https://memba.club/os', beta, 404, 'text/html', 'GET'],
        ['https://memba.club/os', beta, 200, 'application/json', 'GET'],
        ['https://memba.club/osmosis', beta, 200, 'text/html', 'GET'],
        ['https://memba.club/os', beta, 200, 'text/html', 'POST'],
    ])('passes through unchanged: %s %s %s %s %s', async (url, html, status, type, method) => {
        const original = page(html, status, type)
        const next = vi.fn(async () => original)
        expect(await handler(new Request(url, { method }), { next })).toBe(original)
        expect(next).toHaveBeenCalledTimes(1)
    })
})
