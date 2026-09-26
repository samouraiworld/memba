/** Path-specific beta metadata in the HTTP response, including requests without JavaScript. */
interface EdgeContext { next: () => Promise<Response> }

export default async function handler(request: Request, context: EdgeContext): Promise<Response> {
    const url = new URL(request.url)
    // The classic host and its previews retain their existing response verbatim.
    if (url.hostname !== 'memba.club' || request.method !== 'GET'
        || (url.pathname !== '/os' && !url.pathname.startsWith('/os/'))) return context.next()

    const response = await context.next()
    if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/html')) return response
    const html = await response.clone().text()
    // Only the explicitly allowed beta build emits this identity marker.
    if (!html.includes('https://memba.club/brand/os/share-1200x630.png')) return response
    const canonical = `https://memba.club${url.pathname}`.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    const body = html
        .replace(/<link rel="canonical" href="[^"]*"\s*\/>/, () => `<link rel="canonical" href="${canonical}" />`)
        .replace(/<meta property="og:url" content="[^"]*"\s*\/>/, () => `<meta property="og:url" content="${canonical}" />`)
    const headers = new Headers(response.headers)
    // Validators and lengths belong to the original index, not the rewritten page.
    for (const name of ['content-length', 'content-encoding', 'etag', 'last-modified']) headers.delete(name)
    headers.set('cache-control', 'private, no-cache')
    return new Response(body, { status: response.status, headers })
}

export const config = { path: ['/os', '/os/*'] }
