import { describe, it, expect } from 'vitest'
import { parseMsgs, parseFee } from './parseMsgs'

describe('parseMsgs', () => {
    it('parses MsgSend with ugnot → GNOT conversion', () => {
        const json = JSON.stringify([{
            type: 'bank/MsgSend',
            value: {
                to_address: 'g10kw7e55e9wc8j8v6904ck29dqwr9fm9u280juh',
                amount: [{ amount: '1500000', denom: 'ugnot' }],
            },
        }])
        const result = parseMsgs(json)
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe('Send')
        expect(result[0].fields.find(f => f.key === 'Amount')?.value).toBe('1.5 GNOT')
    })

    it('parses MsgSend with exact 1 GNOT (1000000 ugnot)', () => {
        const json = JSON.stringify([{
            type: 'bank/MsgSend',
            value: {
                to_address: 'g1test',
                amount: [{ amount: '1000000', denom: 'ugnot' }],
            },
        }])
        const result = parseMsgs(json)
        expect(result[0].fields.find(f => f.key === 'Amount')?.value).toBe('1 GNOT')
    })

    it('parses MsgCall with package, function, and args', () => {
        const json = JSON.stringify([{
            type: 'vm/MsgCall',
            value: {
                pkg_path: 'gno.land/r/gov/dao',
                func: 'VoteOnProposal',
                args: ['1', 'YES'],
            },
        }])
        const result = parseMsgs(json)
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe('Contract Call')
        expect(result[0].label).toBe('Call VoteOnProposal')
        expect(result[0].fields.find(f => f.key === 'Function')?.value).toBe('VoteOnProposal')
        expect(result[0].fields.find(f => f.key === 'Arguments')?.value).toBe('1, YES')
    })

    it('parses MsgAddPackage with path and deposit', () => {
        const json = JSON.stringify([{
            type: 'vm/MsgAddPackage',
            value: {
                package: { path: 'gno.land/r/zooma/test_dao' },
                deposit: [{ amount: '10000000', denom: 'ugnot' }],
            },
        }])
        const result = parseMsgs(json)
        expect(result[0].type).toBe('Deploy Package')
        expect(result[0].label).toBe('Deploy test_dao')
    })

    it('returns fallback for invalid JSON', () => {
        const result = parseMsgs('not json at all')
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe('Unknown')
    })

    it('returns empty array for empty msgs array', () => {
        const result = parseMsgs('[]')
        expect(result).toHaveLength(0)
    })

    it('returns fallback for non-array JSON', () => {
        const result = parseMsgs('{"foo": "bar"}')
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe('Unknown')
    })
})

describe('parseFee', () => {
    it('parses fee with gas and amount', () => {
        const json = JSON.stringify({
            gas: '100000',
            amount: [{ amount: '1000', denom: 'ugnot' }],
        })
        const result = parseFee(json)
        expect(result.gas).toBe('100000')
    })

    it('returns fallback for invalid JSON', () => {
        const result = parseFee('broken')
        expect(result.gas).toBe('—')
        expect(result.amount).toBe('—')
    })
})
