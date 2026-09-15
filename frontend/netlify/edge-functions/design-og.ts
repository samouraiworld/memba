/** Professional share metadata for browserless crawlers. No RPC, session or balance access. */
import { isBotUserAgent } from '../../src/lib/feedOg.ts'
import { matchRouteMeta } from '../../src/lib/routeMeta.ts'
interface EdgeContext { next: () => Promise<Response> }
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
export default async function handler(request: Request, context: EdgeContext): Promise<Response> {
    const response = await context.next()
    if (!isBotUserAgent(request.headers.get('user-agent')) || !response.headers.get('content-type')?.includes('text/html')) return response
    const html = await response.clone().text()
    // Only full-design builds carry this marker; legacy responses are preserved.
    if (!html.includes('/brand/folded-m/share.png')) return response
    const url = new URL(request.url)
    const key = url.pathname.split('/')[1]
    const networks: Record<string, string> = { mainnet: 'gno.land', pearl: 'Pearl', gnoland1: 'Betanet' }
    const meta = matchRouteMeta(url.pathname, key in networks ? key : '')
    const title = `${meta.title}${networks[key] ? ` · ${networks[key]}` : ''}`
    const replacements: Record<string, string> = { 'og:title': title, 'twitter:title': title, 'og:description': meta.description, 'twitter:description': meta.description,
        'og:image': `${url.origin}/brand/folded-m/share.png`, 'twitter:image': `${url.origin}/brand/folded-m/share.png`, 'og:url': url.origin + url.pathname }
    let output = html
    for (const [name, value] of Object.entries(replacements)) {
        const pattern = new RegExp(`(<meta (?:property|name)="${name}"\\s+content=")[^"]*("\\s*\\/?>)`, 'g')
        output = output.replace(pattern, (_match, start, end) => `${start}${escape(value)}${end}`)
    }
    const headers = new Headers(response.headers)
    headers.delete('content-length'); headers.delete('content-encoding'); headers.delete('etag')
    headers.set('vary', [headers.get('vary'), 'User-Agent'].filter(Boolean).join(', ')); headers.set('cache-control', 'private, max-age=60')
    return new Response(output, { status: response.status, headers })
}
export const config = { path: '/*' }
