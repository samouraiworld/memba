import { describe, it, expect } from 'vitest'
import handler from './design-og'
const html = '<html><head><meta property="og:title" content="Memba"><meta property="og:description" content="Original"><meta property="og:image" content="/brand/folded-m/share.png"><meta name="twitter:image" content="/brand/folded-m/share.png"><meta property="og:url" content="/pearl"></head><body>Application</body></html>'
const response = (body = html) => new Response(body, { headers: { 'content-type': 'text/html', etag: 'original' } })
describe('professional crawler cards', () => {
    it('leaves human requests unchanged', async () => {
        const original = response()
        expect(await handler(new Request('https://example.com/mainnet/validators'), { next: async () => original })).toBe(original)
    })
    it('leaves legacy builds unchanged', async () => {
        const original = response(html.replaceAll('/brand/folded-m/share.png', '/og-image.jpg'))
        expect(await handler(new Request('https://example.com/mainnet/validators', { headers: { 'user-agent': 'Twitterbot/1.0' } }), { next: async () => original })).toBe(original)
    })
    it.each(['mainnet/validators', 'pearl/dao/gno.land/r/gov/dao', 'mainnet/dao/gno.land/r/gov/dao/proposal/4'])('uses absolute brand image and network metadata for %s', async path => {
        const result = await handler(new Request(`https://example.com/${path}?private-query=removed`, { headers: { 'user-agent': 'Twitterbot/1.0' } }), { next: async () => response() })
        const text = await result.text()
        expect(text).toContain('https://example.com/brand/folded-m/share.png')
        expect(text).toContain(path.startsWith('mainnet') ? '· gno.land' : '· Pearl')
        expect(text).not.toContain('private-query')
        expect(result.headers.get('etag')).toBeNull()
        expect(result.headers.get('vary')).toContain('User-Agent')
    })
})
