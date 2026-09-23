import { describe, it, expect } from 'vitest'
import { parseMsgs, parseFee, deployEffect } from './parseMsgs'

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

    // Legacy stored shape (vm/MsgAddPackage with a deposit key) still reads.
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
        expect(result[0].label).toBe('Deploy realm gno.land/r/zooma/test_dao')
        expect(result[0].fields.find(f => f.key === 'Deposit')?.value).toBe('10 GNOT')
    })

    it('parses the /vm.m_addpkg deploy the app sends, with its storage deposit cap', () => {
        const msg = { type: '/vm.m_addpkg', value: { creator: 'g1x', package: { path: 'gno.land/r/nym-alice123/team', files: [] }, send: '', max_deposit: '13000000ugnot' } }
        const [parsed] = parseMsgs(JSON.stringify([msg]))
        expect(parsed.label).toBe('Deploy realm gno.land/r/nym-alice123/team')
        expect(parsed.fields).toContainEqual({ key: 'Storage deposit cap', value: '13 GNOT', accent: true })
        expect(parseMsgs(JSON.stringify([{ ...msg, type: 'vm/m_addpkg' }]))[0].label).toBe('Deploy realm gno.land/r/nym-alice123/team')
        expect(deployEffect(msg)).toEqual({ path: 'gno.land/r/nym-alice123/team', depositCap: '13 GNOT' })
        expect(deployEffect({ type: 'vm/MsgCall', value: { func: 'Vote' } })).toBeNull()
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

describe('native monetary display', () => {
    it.each([
        ['5000000ugnot', '5 GNOT'],
        ['1ugnot', '0.000001 GNOT'],
        ['0ugnot', '0 GNOT'],
        ['9223372036854775807ugnot', '9223372036854.775807 GNOT'],
        ['9007199254740993uatom', '9,007,199,254,740,993 uatom'],
        ['1e6ugnot', '1 e6ugnot'], // denomination, not exponent notation
        ['1uatom,2500000ugnot', '1 uatom + 2.5 GNOT'],
        ['', '0'],
    ])('renders %s exactly as %s', (amount, expected) => {
        const msg = parseMsgs(JSON.stringify([{ '@type': '/bank.MsgSend', amount }]))[0]
        expect(msg.fields.find(f => f.key === 'Amount')?.value).toBe(expected)
        expect(msg.reviewError).toBeUndefined()
        expect(parseFee(JSON.stringify({ gas_wanted: '10000000', gas_fee: amount }))).toEqual({ gas: '10000000', amount: expected })
    })

    it('preserves exact legacy array values and denomination identity', () => {
        expect(parseFee(JSON.stringify({ gas: '42', amount: [{ amount: '9007199254740993', denom: 'uToken' }] }))).toEqual({ gas: '42', amount: '9,007,199,254,740,993 uToken' })
    })

    it.each([123, null, {}, [null], [{ amount: 123, denom: 'ugnot' }], '1.5ugnot', '-1ugnot', '1ugnot,', '1ugnot<script>'])('marks malformed monetary input unsafe: %j', amount => {
        expect(parseFee(JSON.stringify({ gas_wanted: '42', gas_fee: amount })).reviewError).toBeTruthy()
        expect(parseMsgs(JSON.stringify([{ '@type': '/bank.MsgSend', amount }]))[0].reviewError).toBeTruthy()
    })

    it('rejects ambiguous fee representations instead of hiding one', () => {
        expect(parseFee('{"gas_fee":"9000000ugnot","amount":[]}').reviewError).toBeTruthy()
    })

    it('retains the complete raw payload in full review mode on parse failure', () => {
        const raw = JSON.stringify([{ type: 'bank/MsgSend', amount: {}, memo: 'x'.repeat(900) }])
        expect(parseMsgs(raw, { full: true })[0].fields[0].value).toBe(raw)
    })
})

describe("parseMsgs signing fields", () => {
    it("keeps each call argument separate and marks addresses and paths to show in full", () => {
        const [msg] = parseMsgs(JSON.stringify([{ type: "vm/MsgCall", value: { pkg_path: "gno.land/r/demo/bank", func: "Pay", args: ["1, 2", "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"] } }]), { full: true })
        const args = msg.fields.find(f => f.key === "Arguments")
        expect(args?.args).toEqual(["1, 2", "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"])
        expect(msg.fields.find(f => f.key === "Package")?.identifier).toBe(true)
        const [send] = parseMsgs(JSON.stringify([{ type: "bank/MsgSend", value: { from_address: "g1from", to_address: "g1to", amount: "1ugnot" } }]), { full: true })
        expect(send.fields.find(f => f.key === "Recipient")).toMatchObject({ value: "g1to", identifier: true })
        expect(send.fields.find(f => f.key === "From")).toMatchObject({ value: "g1from", identifier: true })
    })
})

