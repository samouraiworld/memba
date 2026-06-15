import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { NETWORKS } from './config'

// The production CSP lives in the repo-root netlify.toml. Every RPC host the app
// may fetch — primary + fallbacks, across ALL networks (hidden ones are still
// reachable via /<network>/... URLs or VITE_GNO_CHAIN_ID) — MUST be permitted by
// connect-src, or the browser refuses the request. This guard exists because the
// gnoland1 fallback RPCs (moul.p2p.team / aeddi.org) were silently CSP-blocked,
// breaking the ChainHaltedBanner health probe. It will also fail loudly if a
// future network (e.g. the test13 cutover) adds an unlisted RPC host.
const here = dirname(fileURLToPath(import.meta.url))
const netlifyToml = readFileSync(resolve(here, '../../../netlify.toml'), 'utf8')

function connectSrcSources(toml: string): string[] {
    const csp = toml.match(/Content-Security-Policy\s*=\s*"([^"]*)"/)?.[1]
    if (!csp) throw new Error('Content-Security-Policy not found in netlify.toml')
    const directive = csp
        .split(';')
        .map((s) => s.trim())
        .find((d) => d.startsWith('connect-src'))
    if (!directive) throw new Error('connect-src directive not found in CSP')
    return directive.replace(/^connect-src\s+/, '').split(/\s+/).filter(Boolean)
}

// Mirror the browser's connect-src host-source matching: exact host, or a
// leading "*." wildcard that matches any sub-domain of the suffix.
function hostAllowed(host: string, sources: string[]): boolean {
    return sources.some((src) => {
        const m = src.match(/^(?:https?|wss?):\/\/([^/:]+)/)
        if (!m) return false
        const pattern = m[1]
        if (pattern.startsWith('*.')) return host.endsWith(pattern.slice(1)) // ".example.com"
        return host === pattern
    })
}

describe('CSP connect-src covers every network RPC host', () => {
    const sources = connectSrcSources(netlifyToml)

    for (const [key, net] of Object.entries(NETWORKS)) {
        const urls = [net.rpcUrl, ...(net.fallbackRpcUrls ?? [])]
        for (const url of urls) {
            const host = new URL(url).hostname
            it(`${key}: ${host} is allowed by connect-src`, () => {
                expect(hostAllowed(host, sources)).toBe(true)
            })
        }
    }
})
