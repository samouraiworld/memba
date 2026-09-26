/** Build-only beta identity. Never imported by the classic runtime. */
export const OS_ORIGIN = 'https://memba.club'
export const OS_BRAND_PATH = '/brand/os/'
export const OS_BRAND_FILES = [
    'favicon.svg', 'favicon-16.png', 'favicon-32.png', 'apple-touch-icon-180.png',
    'icon-192.png', 'icon-512.png', 'maskable-512.png',
    'share-1200x630.png', 'share-1200x1200.png',
] as const

export function osIdentityAllowed(env: Record<string, string | undefined>): boolean {
    return env.VITE_MEMBA_OS === 'true' && env.MEMBA_OS_BETA_SITE === 'true'
}

const title = 'Memba OS — A home for gno.land.'
const description = 'A home for gno.land. Explore apps, communities and tools in Memba OS. Public Beta on mainnet.'
const share = `${OS_ORIGIN}${OS_BRAND_PATH}share-1200x630.png`
const shareAlt = 'Memba OS — A home for gno.land. Public Beta at memba.club, on an Aqua desktop.'

/** Replace only identity tags; keep the original source head and security scripts intact. */
export function osSiteHtml(html: string): string {
    return html
        .replace(/<title>[\s\S]*?<\/title>/, '')
        .replace(/<meta\b[^>]*(?:name="(?:description|theme-color|apple-mobile-web-app-title|twitter:[^"]+)"|property="og:[^"]+")[^>]*>/g, '')
        .replace(/<link\b[^>]*rel="(?:icon|apple-touch-icon|canonical)"[^>]*>/g, '')
        .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '')
        .replace('</head>', `
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <meta name="theme-color" content="#0F1218" />
  <meta name="theme-color" content="#E9EDF4" media="(prefers-color-scheme: light)" />
  <meta name="apple-mobile-web-app-title" content="Memba OS" />
  <link rel="canonical" href="${OS_ORIGIN}/" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Memba OS" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:url" content="${OS_ORIGIN}/" />
  <meta property="og:image" content="${share}" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${shareAlt}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@samouraicoop" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${share}" />
  <meta name="twitter:image:alt" content="${shareAlt}" />
  <link rel="icon" type="image/svg+xml" href="${OS_BRAND_PATH}favicon.svg" />
  <link rel="icon" type="image/png" sizes="32x32" href="${OS_BRAND_PATH}favicon-32.png" />
  <link rel="icon" type="image/png" sizes="16x16" href="${OS_BRAND_PATH}favicon-16.png" />
  <link rel="apple-touch-icon" sizes="180x180" href="${OS_BRAND_PATH}apple-touch-icon-180.png" />
  <script type="application/ld+json">${JSON.stringify({
            '@context': 'https://schema.org', '@type': 'WebApplication',
            name: 'Memba OS', url: `${OS_ORIGIN}/`, description,
            image: share, applicationCategory: 'SocialNetworkingApplication', operatingSystem: 'Web',
            publisher: { '@type': 'Organization', name: 'Samourai Coop', url: 'https://samourai.world' },
        })}</script>
</head>`)
}

export const osManifest = {
    name: 'Memba OS', short_name: 'Memba OS', id: '/os', start_url: '/os', scope: '/',
    display: 'standalone' as const, background_color: '#E9EDF4', theme_color: '#4C6EF5', description,
    icons: [
        { src: `${OS_BRAND_PATH}icon-192.png`, sizes: '192x192', type: 'image/png' },
        { src: `${OS_BRAND_PATH}icon-512.png`, sizes: '512x512', type: 'image/png' },
        { src: `${OS_BRAND_PATH}maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' as const },
    ],
}
