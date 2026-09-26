import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

describe('Meet analytics privacy', () => {
    it('redacts room codes from the actual Plausible pageview and event payloads', () => {
        const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
        const snippet = html.match(/<script>\s*(window\.plausible=[\s\S]*?)<\/script>/)?.[1]
        expect(snippet).toBeTruthy()
        const sandbox: Record<string, unknown> = {}
        sandbox.window = sandbox
        runInNewContext(snippet!, sandbox)
        const transform = (sandbox.plausible as { o: { transformRequest: (payload: unknown) => unknown } }).o.transformRequest
        const room = 'abc-defg-hij'
        const payload = {
            u: `https://memba.club/os/meet/${room}`,
            r: `https://memba.club/os/feed?w=meet.${room}`,
            p: { outbound_url: `https://visio.samourai.app/${room}`, nested: { target: `/os/meet/${room}`, code: room } },
        }
        expect(JSON.stringify(transform(payload))).not.toContain(room)
        expect(payload.u).toBe('https://memba.club/os/meet/[redacted]')
        const ordinary = { u: 'https://memba.club/os/daos', p: { source: 'menu' } }
        expect(transform(ordinary)).toBe(ordinary)
        expect(ordinary.u).toBe('https://memba.club/os/daos')
    })
})
