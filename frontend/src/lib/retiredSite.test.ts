import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Netlify applies the first matching [[redirects]] rule. The retired host's rules sit in
// the netlify.toml both sites share: below the SPA fallback they never fire, and the
// classic site keeps answering 200 with no error anywhere.
const here = dirname(fileURLToPath(import.meta.url))
const netlifyToml = readFileSync(resolve(here, '../../../netlify.toml'), 'utf8')

type Rule = { from: string, to: string, status: string, force: boolean }
const rules: Rule[] = netlifyToml.split('[[redirects]]').slice(1).map((block) => {
    const body = block.split(/\n\[/)[0]
    const field = (k: string) => new RegExp(`^\\s*${k}\\s*=\\s*"?([^"\\n]*)"?`, 'm').exec(body)?.[1] ?? ''
    return { from: field('from'), to: field('to'), status: field('status'), force: field('force') === 'true' }
})
// The retired classic site: the domain and its Netlify canary.
const RETIRED_HOSTS = ['memba.samourai.app', 'memba-multisig.netlify.app']
const NEW_ORIGIN = 'https://memba.club'

const firstIndex = (from: string) => rules.findIndex((r) => r.from === from)

describe('retired classic host redirects to memba.club', () => {
    for (const host of RETIRED_HOSTS) {
        it(`${host} serves the service-worker kill switch, then redirects every path, before any other rule`, () => {
            const sw = firstIndex(`https://${host}/sw.js`)
            const all = firstIndex(`https://${host}/*`)
            expect(sw, 'sw.js rule').toBeGreaterThanOrEqual(0)
            expect(all, 'catch-all rule').toBeGreaterThan(sw)
            expect(rules[sw]).toMatchObject({ to: '/sw-retire.js', status: '200', force: true })
            expect(rules[all]).toMatchObject({ to: `${NEW_ORIGIN}/:splat`, status: '301', force: true })
            const firstHostless = rules.findIndex((r) => r.from.startsWith('/'))
            expect(all).toBeLessThan(firstHostless)
        })
    }
})
