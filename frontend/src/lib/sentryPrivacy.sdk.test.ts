import { afterEach, describe, expect, it } from 'vitest'
import * as Sentry from '@sentry/react'
import { ConnectError } from '@connectrpc/connect'
import { queryClient } from './queryClient'
import { logChainError } from './errorLog'
import { redactSentryBreadcrumb, redactSentryEvent } from './sentryPrivacy'

// Actual SDK + serialization, with an in-memory transport: no telemetry network.
const address = `g1${'a'.repeat(38)}`
const jwt = 'eyJTeW50aGV0aWM.UE9CRQ.U0lHTkFUVVJF'
const sensitive = `${address} ${jwt}`

afterEach(async () => {
    queryClient.clear()
    await Sentry.close(2000)
    Sentry.getIsolationScope().clear()
    Sentry.getCurrentScope().clear()
})

describe('Sentry privacy through the actual SDK transport', () => {
    it('scrubs stored query/console breadcrumbs and outgoing error/transaction envelopes', async () => {
        const bodies: string[] = []
        Sentry.init({
            dsn: 'https://00000000000000000000000000000000@telemetry.invalid/1',
            sendDefaultPii: false,
            tracesSampleRate: 1,
            beforeBreadcrumb: redactSentryBreadcrumb,
            beforeSend: redactSentryEvent,
            beforeSendTransaction: redactSentryEvent,
            transport: options => Sentry.createTransport(options, request => {
                bodies.push(typeof request.body === 'string' ? request.body : new TextDecoder().decode(request.body))
                return Promise.resolve({ statusCode: 200 })
            }),
        })
        const items = () => bodies.flatMap(body => {
            const lines = body.split('\n')
            const result: { type: string, payload: Sentry.Event }[] = []
            for (let i = 1; i < lines.length; i += 2) {
                if (lines[i]) result.push({ type: JSON.parse(lines[i]).type, payload: JSON.parse(lines[i + 1]) })
            }
            return result
        })
        const event = (id: string) => items().find(item => item.payload.event_id === id)?.payload
        const safe = (value: unknown) => {
            const text = JSON.stringify(value)
            expect(text).not.toContain(address)
            expect(text).not.toContain(jwt)
        }

        const queryKey = ['standing', address]
        await expect(queryClient.fetchQuery({ queryKey, retry: false,
            queryFn: () => { throw new Error(sensitive) },
        })).rejects.toThrow(sensitive)
        const stored = Sentry.getIsolationScope().getScopeData().breadcrumbs
        safe(stored)
        expect(stored.find(crumb => crumb.category === 'gnolove.query')?.data?.queryKey)
            .toEqual(['standing', '[REDACTED_ADDRESS]'])
        expect(queryKey).toEqual(['standing', address])
        expect(items().filter(item => item.type === 'event')).toHaveLength(0)

        console.warn('synthetic console-only failure', new TypeError(sensitive))
        Sentry.addBreadcrumb({ category: 'transport', data: { error: new ConnectError(sensitive) } })
        logChainError('synthetic-chain', new Error(sensitive), 'critical', address)
        expect(await Sentry.flush(2000)).toBe(true)
        const chain = items().find(item => item.payload.tags?.context === 'synthetic-chain')?.payload
        expect(chain?.tags?.severity).toBe('critical')
        expect(chain?.exception?.values?.[0]?.value).toBe('[REDACTED_ADDRESS] [REDACTED_JWT]')
        expect(chain?.breadcrumbs?.some(crumb => crumb.category === 'console')).toBe(true)
        const warning = chain?.breadcrumbs?.find(crumb => crumb.category === 'console' && crumb.level === 'warning')
        expect(warning?.data?.arguments?.[1]?.stack).toContain('TypeError: [REDACTED_ADDRESS] [REDACTED_JWT]')
        expect(warning?.data?.arguments?.[1]?.stack).toContain('sentryPrivacy.sdk.test.ts')
        const transportError = chain?.breadcrumbs?.find(crumb => crumb.category === 'transport')?.data?.error
        expect(transportError?.stack).toContain('ConnectError: [unknown] [REDACTED_ADDRESS] [REDACTED_JWT]')
        safe(chain)

        // Direct event breadcrumbs bypass beforeBreadcrumb; both send hooks
        // must handle the representation returned by SDK normalization.
        const errorId = Sentry.captureEvent({ message: sensitive,
            exception: { values: [{ value: sensitive }, { value: jwt }] },
            breadcrumbs: [{ category: 'late', data: { token: jwt }, message: address }],
        })
        const transactionId = Sentry.captureEvent({ type: 'transaction', transaction: 'synthetic-navigation',
            start_timestamp: 100, timestamp: 101,
            contexts: { trace: { trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16) } },
            breadcrumbs: [{ category: 'late', data: { token: jwt }, message: address }],
        })
        expect(await Sentry.flush(2000)).toBe(true)
        expect(event(errorId)?.message).toBe('[REDACTED_ADDRESS] [REDACTED_JWT]')
        expect(event(transactionId)?.type).toBe('transaction')
        expect(event(transactionId)?.transaction).toBe('synthetic-navigation')
        for (const id of [errorId, transactionId]) {
            expect(event(id)?.breadcrumbs?.find(crumb => crumb.category === 'late')?.message).toBe('[REDACTED_ADDRESS]')
            safe(event(id))
        }
        safe(bodies)
    })
})
