import { afterEach, describe, expect, it, vi } from 'vitest'
import handler from '../../netlify/edge-functions/feed-og'
afterEach(() => vi.unstubAllGlobals())
describe('feed share branding follows the deployed presentation', () => {
    it.each([false, true])('preserves post metadata with professional=%s', async professional => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ root: { id: '1', author: 'g1fixture', body: 'Community planning', hidden: false, deleted: false } }), { status: 200 })))
        const next = vi.fn().mockResolvedValue(new Response(`<html>${professional ? '/brand/folded-m/share.png' : '/og-image.jpg'}</html>`, { headers: { 'content-type': 'text/html' } }))
        const result = await handler(new Request('https://example.com/feed/post/1', { headers: { 'user-agent': 'Twitterbot/1.0' } }), { next })
        const html = await result.text()
        expect(html).toContain(`https://example.com${professional ? '/brand/folded-m/share.png' : '/og-image.jpg'}`)
        expect(html).toContain('Community planning')
        expect(next).toHaveBeenCalledTimes(1)
    })
    it('still suppresses moderated post content', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ root: { id: '1', author: 'g1fixture', body: 'Hidden content must not leak', hidden: true, deleted: false } }), { status: 200 })))
        const result = await handler(new Request('https://example.com/feed/post/1', { headers: { 'user-agent': 'Twitterbot/1.0' } }), { next: async () => new Response('/brand/folded-m/share.png', { headers: { 'content-type': 'text/html' } }) })
        expect(await result.text()).not.toContain('Hidden content must not leak')
    })
})
