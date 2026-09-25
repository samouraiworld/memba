import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
    DEFAULT_GNOLOVE_API_URL,
    DEFAULT_GNO_MONITORING_API_URL,
    TRUSTED_GNOLOVE_API_DOMAINS,
    TRUSTED_MONITORING_DOMAINS,
} from './config'

// gnolove.world lapsed in 2026-09 (no NS records). Whoever re-registers it would
// receive every request Memba still sends there, so no default, allowlist entry
// or CSP source may name it again. The sources are read as text so a comment-
// free literal anywhere in them fails too, not only the exported values.
const LAPSED = /gnolove\.world/i

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf8')
const netlifyToml = read('../../../netlify.toml')
const indexHtml = read('../../index.html')
const configTs = read('./config.ts')

function connectSrc(csp: string): string[] {
    const directive = csp
        .split(';')
        .map((s) => s.trim())
        .find((d) => d.startsWith('connect-src'))
    if (!directive) throw new Error('connect-src directive not found')
    return directive.replace(/^connect-src\s+/, '').split(/\s+/).filter(Boolean)
}

const netlifyCsp = netlifyToml.match(/Content-Security-Policy\s*=\s*"([^"]*)"/)?.[1] ?? ''
const htmlCsp = indexHtml.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/)?.[1] ?? ''

describe('the lapsed gnolove.world domain is never trusted or defaulted', () => {
    it('is absent from the service defaults and allowlists', () => {
        for (const v of [DEFAULT_GNOLOVE_API_URL, DEFAULT_GNO_MONITORING_API_URL, ...TRUSTED_GNOLOVE_API_DOMAINS, ...TRUSTED_MONITORING_DOMAINS]) {
            expect(v).not.toMatch(LAPSED)
        }
    })

    it('is absent from config.ts', () => {
        expect(configTs).not.toMatch(LAPSED)
    })

    it('is absent from both CSPs', () => {
        expect(netlifyCsp, 'netlify.toml CSP not found').not.toBe('')
        expect(htmlCsp, 'index.html CSP not found').not.toBe('')
        expect(netlifyCsp).not.toMatch(LAPSED)
        expect(htmlCsp).not.toMatch(LAPSED)
    })
})

describe('both CSPs let the app reach its external service defaults', () => {
    // Mirrors the browser's host-source matching: exact host or a leading "*.".
    const allows = (sources: string[], host: string) => sources.some((src) => {
        const m = src.match(/^https:\/\/([^/:]+)/)
        if (!m) return false
        return m[1].startsWith('*.') ? host.endsWith(m[1].slice(1)) : host === m[1]
    })

    for (const url of [DEFAULT_GNOLOVE_API_URL, DEFAULT_GNO_MONITORING_API_URL]) {
        const host = new URL(url).hostname
        it(`${host} is allowed by netlify.toml and index.html`, () => {
            expect(allows(connectSrc(netlifyCsp), host)).toBe(true)
            expect(allows(connectSrc(htmlCsp), host)).toBe(true)
        })
    }
})
