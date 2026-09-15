import { describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import { ConnectError } from '@connectrpc/connect'
import { redactSentryBreadcrumb, redactSentryEvent } from './sentryPrivacy'

const address = `g1${'a'.repeat(38)}`
const jwt = 'eyJTeW50aGV0aWM.UE9CRQ.U0lHTkFUVVJF'
const sensitive = `${address} ${jwt}`
const redacted = '[REDACTED_ADDRESS] [REDACTED_JWT]'

describe('Sentry breadcrumb privacy boundary', () => {
    it('scrubs nested query keys, errors, console arguments and object keys', () => {
        const result = redactSentryBreadcrumb({
            category: 'gnolove.query', message: `Query failed: ${sensitive}`,
            data: { queryKey: ['standing', address], error: jwt, arguments: [{ [address]: [sensitive] }] },
        })
        expect(result).toEqual({
            category: 'gnolove.query', message: `Query failed: ${redacted}`,
            data: { queryKey: ['standing', '[REDACTED_ADDRESS]'], error: '[REDACTED_JWT]', arguments: [{ '[REDACTED_ADDRESS]': [redacted] }] },
        })
        expect(JSON.stringify(result)).not.toContain(address)
        expect(JSON.stringify(result)).not.toContain(jwt)
    })

    it('preserves ordinary breadcrumb metadata and primitive data', () => {
        const crumb = { category: 'fetch', type: 'http', level: 'info' as const, timestamp: 123,
            data: { status_code: 200, method: 'GET', url: '/health', ok: true, empty: null, items: [1, 'two'] } }
        expect(redactSentryBreadcrumb(crumb)).toEqual(crumb)
    })

    it('detaches all nested values without mutating application-owned data', () => {
        const key = Object.freeze(['standing', address])
        const data = { queryKey: key, nested: { text: 'original' } }
        const result = redactSentryBreadcrumb(Object.freeze({ data }))!
        data.nested.text = sensitive
        expect(result.data?.nested).toEqual({ text: 'original' })
        expect(key[1]).toBe(address)
        expect(result.data).not.toBe(data)
    })

    it('scrubs standard Error fields without exposing hidden application properties', () => {
        const error = new Error(sensitive, { cause: new Error(jwt) })
        Object.defineProperty(error, 'privateDetail', { value: 'synthetic-private-detail' })
        Object.defineProperty(error, 'publicDetail', { enumerable: true, value: sensitive })
        const result = redactSentryBreadcrumb({ data: { arguments: [error] } })!
        const snapshot = result.data?.arguments[0]
        expect(snapshot).not.toHaveProperty('cause')
        expect(snapshot).not.toHaveProperty('privateDetail')
        expect(snapshot).toHaveProperty('publicDetail', redacted)
        const body = JSON.stringify(result)
        expect(body).toContain('[REDACTED_ADDRESS]')
        expect(body).toContain('[REDACTED_JWT]')
        expect(body).not.toContain(address)
        expect(body).not.toContain(jwt)
        expect(error.message).toBe(sensitive)
        Object.defineProperty(error, 'cause', { enumerable: true })
        expect(redactSentryBreadcrumb({ data: { error } })?.data?.error)
            .toHaveProperty('cause.message', '[REDACTED_JWT]')
    })

    it('never executes getters or custom serialization methods', () => {
        const getter = vi.fn(() => sensitive)
        const toJSON = vi.fn(() => sensitive)
        const input = { toJSON, nested: Object.defineProperty({}, 'secret', { enumerable: true, get: getter }) }
        const result = redactSentryBreadcrumb({ data: { arguments: [input] } })
        expect(JSON.stringify(result)).not.toContain(address)
        expect(getter).not.toHaveBeenCalled()
        expect(toJSON).not.toHaveBeenCalled()
    })

    it('preserves built-in error names and dates without calling custom serializers', () => {
        const date = new Date('2026-09-14T00:00:00Z')
        date.toJSON = vi.fn(() => sensitive)
        const result = redactSentryBreadcrumb({ data: { error: new TypeError(sensitive), date } })!
        expect(result.data?.date).toBe('2026-09-14T00:00:00.000Z')
        expect(result.data?.error).toMatchObject({ name: 'TypeError', message: redacted })
        expect(date.toJSON).not.toHaveBeenCalled()
    })

    it('preserves native console-error stacks, but never invokes custom stack/message getters', () => {
        const error = new TypeError(sensitive)
        const result = redactSentryBreadcrumb({ data: { error } })!
        expect((result.data?.error as Record<string, unknown>).stack).toContain('TypeError: ' + redacted)
        expect((result.data?.error as Record<string, unknown>).stack).toContain('sentryPrivacy.test.ts')
        const transportError = new ConnectError(sensitive)
        const transport = redactSentryBreadcrumb({ data: { error: transportError } })!
        expect((transport.data?.error as Record<string, unknown>).stack).toContain('ConnectError: [unknown] ' + redacted)
        expect((transport.data?.error as Record<string, unknown>).stack).toContain('sentryPrivacy.test.ts')
        const getter = vi.fn(() => sensitive)
        Object.defineProperty(error, 'stack', { get: getter })
        expect(redactSentryBreadcrumb({ data: { error } })?.data?.error).toMatchObject({ stack: '[Accessor]' })
        const customMessage = Object.defineProperty(new Error(), 'message', { get: getter })
        redactSentryBreadcrumb({ data: { error: customMessage } })
        const customName = Object.defineProperty(new Error(), 'name', { get: getter })
        redactSentryBreadcrumb({ data: { error: customName } })
        let prototype = Object.defineProperty(Object.create(Error.prototype), 'name', { get: getter })
        for (let i = 0; i < 6; i++) prototype = Object.create(prototype)
        const deepError = Object.setPrototypeOf(new Error(), prototype)
        expect(redactSentryBreadcrumb({ data: { error: deepError } })).toBeNull()
        expect(getter).not.toHaveBeenCalled()
    })

    it('matches the existing token policy, including embedded prefixes and adjacent tokens', () => {
        const oldMask = (text: string) => text.replace(/g1[a-z0-9]{38}/gi, '[REDACTED_ADDRESS]')
            .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]')
        const check = (text: string) => expect(redactSentryEvent({ message: text }).message).toBe(oldMask(text))
        for (const text of [jwt, `prefix_${jwt}.${jwt}`, `eyJ.a.b eyJa.b.c`, `${jwt}/${jwt}`, `eyJa.eyJb.c.d`, `aeyJx.b.c`]) check(text)
        fc.assert(fc.property(fc.array(fc.constantFrom('eyJ', 'abc', '.', '-', '_', '/', ' ', '0'), { maxLength: 80 }),
            parts => { check(parts.join('')) }), { numRuns: 1000, seed: 20260914 })
    })

    it('bounds cumulative string input and processes repeated JWT prefixes without quadratic retries', () => {
        const long = 'eyJ'.repeat(40_000)
        const start = performance.now()
        expect(redactSentryBreadcrumb({ message: long })).toBeNull()
        expect(redactSentryBreadcrumb({ data: { first: 'a'.repeat(20_000), second: 'b'.repeat(20_000) } })).toBeNull()
        expect(redactSentryBreadcrumb({ data: { huge: BigInt('9'.repeat(40_000)) } })).toBeNull()
        // Outgoing error messages retain their content; the matcher itself must
        // be linear as well, rather than relying only on the breadcrumb budget.
        expect(redactSentryEvent({ message: long }).message).toBe(long)
        expect(performance.now() - start).toBeLessThan(1000)
    })

    it('keeps colliding redacted keys distinct and ignores normalization-hint symbols', () => {
        const data = { [address]: 'first', [`g1${'b'.repeat(38)}`]: 'second', '[REDACTED_ADDRESS]': 'third',
            [Symbol('skip normalization')]: sensitive }
        expect(redactSentryBreadcrumb({ data })?.data).toEqual({
            '[REDACTED_ADDRESS]': 'first', '[REDACTED_ADDRESS] (1)': 'second', '[REDACTED_ADDRESS] (2)': 'third',
        })
    })

    it('replaces cycles, but preserves repeated non-cyclic references', () => {
        const shared = { text: sensitive }
        const data: Record<string, unknown> = { first: shared, second: shared }
        data.self = data
        const result = redactSentryBreadcrumb({ data })!
        expect(result.data?.first).toEqual({ text: redacted })
        expect(result.data?.second).toEqual({ text: redacted })
        expect(result.data?.self).toBe('[Circular]')
    })

    it('drops over-budget and uninspectable breadcrumbs without throwing', () => {
        let deep: unknown = sensitive
        for (let i = 0; i < 20; i++) deep = { deep }
        expect(redactSentryBreadcrumb({ data: { deep } })).toBeNull()
        expect(redactSentryBreadcrumb({ data: { wide: Array.from({ length: 2000 }, () => sensitive) } })).toBeNull()
        const proxy = new Proxy({}, { ownKeys() { throw new Error(sensitive) } })
        expect(redactSentryBreadcrumb({ data: proxy })).toBeNull()
    })

    it('does not retain executable prototypes or permit prototype pollution', () => {
        const data = JSON.parse('{"__proto__":{"polluted":true}}')
        data.constructor = { name: sensitive }
        const result = redactSentryBreadcrumb({ data })!
        expect(Object.getPrototypeOf(result.data)).toBeNull()
        expect(JSON.stringify(result)).not.toContain(address)
        expect(Object.prototype).not.toHaveProperty('polluted')
    })

    it('masks uppercase addresses and multiple occurrences without stateful regex leaks', () => {
        for (let i = 0; i < 2; i++) {
            expect(redactSentryBreadcrumb({ message: `${address.toUpperCase()} ${sensitive}` })?.message)
                .toBe(`[REDACTED_ADDRESS] ${redacted}`)
        }
    })
})

describe('Sentry outgoing event privacy boundary', () => {
    it('keeps existing message/linked-exception redaction and rescrubs late breadcrumbs', () => {
        const event = { message: sensitive, exception: { values: [{ value: sensitive }, { value: jwt }] },
            breadcrumbs: [{ message: sensitive, data: { arguments: [sensitive] } }], tags: { feature: 'points' } }
        const result = redactSentryEvent(event)
        expect(result.message).toBe(redacted)
        expect(result.exception?.values?.map(value => value.value)).toEqual([redacted, '[REDACTED_JWT]'])
        expect(result.tags).toEqual({ feature: 'points' })
        expect(JSON.stringify(result)).not.toContain(address)
        expect(JSON.stringify(result)).not.toContain(jwt)
        expect(event.message).toBe(sensitive)
        expect(event.breadcrumbs[0].message).toBe(sensitive)
    })

    it('preserves transactions, spans and empty events while scrubbing their breadcrumbs', () => {
        const event = { type: 'transaction' as const, transaction: 'navigation', spans: [],
            breadcrumbs: [{ data: { from: `/member/${address}`, to: '/home' } }] }
        const result = redactSentryEvent(event)
        expect(result.type).toBe('transaction')
        expect(result.transaction).toBe('navigation')
        expect(result.spans).toEqual([])
        expect(JSON.stringify(result.breadcrumbs)).not.toContain(address)
        expect(redactSentryEvent({})).toEqual({})
    })

    it('drops only unsafe breadcrumbs, retaining the event and its useful breadcrumbs', () => {
        const result = redactSentryEvent({ message: 'ordinary error', breadcrumbs: [
            { message: 'useful', data: { status: 503 } },
            { data: { wide: Array.from({ length: 2000 }, () => sensitive) } },
        ] })
        expect(result).toEqual({ message: 'ordinary error', breadcrumbs: [{ message: 'useful', data: { status: 503 } }] })
    })
})
