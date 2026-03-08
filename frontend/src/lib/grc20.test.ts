/**
 * Unit tests for grc20.ts — GRC20 token helpers.
 *
 * Tests cover: fee calculation (2.5%), message builders, token list parsing,
 * token info parsing, sanitization, Adena message conversion,
 * and v2.1a Memba-specific helpers.
 */
import { describe, it, expect } from 'vitest'
import {
    calculateFee,
    feeDisclosure,
    buildCreateTokenMsgs,
    buildCreateTokenWithAdminMsgs,
    buildCreateMembaTokenMsgs,
    buildMintMsgs,
    buildTransferMsg,
    buildBurnMsg,
    buildApproveMsg,
    buildFaucetMsg,
    toAdenaMessages,
    formatTokenAmount,
    PLATFORM_FEE_RATE,
    FEE_RECIPIENT,
    GRC20_FACTORY_PATH,
} from './grc20'

// ── Fee Calculation (v2.1a: 2.5%) ───────────────────────────────

describe('calculateFee', () => {
    it('calculates 2.5% of 1000', () => {
        expect(calculateFee(1000n)).toBe(25n) // 1000 * 25 / 1000
    })

    it('rounds down (floor division)', () => {
        expect(calculateFee(99n)).toBe(2n) // 99 * 25 / 1000 = 2.475 → 2
    })

    it('returns 0 for 0 input', () => {
        expect(calculateFee(0n)).toBe(0n)
    })

    it('handles large amounts', () => {
        expect(calculateFee(1000000000n)).toBe(25000000n) // 2.5%
    })

    it('returns 0 for amounts less than 40', () => {
        expect(calculateFee(39n)).toBe(0n) // 39 * 25 / 1000 = 0
    })

    it('returns 1 for amount 40', () => {
        expect(calculateFee(40n)).toBe(1n) // 40 * 25 / 1000 = 1
    })
})

describe('feeDisclosure', () => {
    it('generates correct disclosure text', () => {
        const text = feeDisclosure(1000n, 'FOO')
        expect(text).toContain('2.5% platform fee')
        expect(text).toContain('25 FOO')
        expect(text).toContain('Samouraï Coop')
    })
})

// ── Constants ───────────────────────────────────────────────────

describe('constants', () => {
    it('PLATFORM_FEE_RATE is 0.025 (2.5%)', () => {
        expect(PLATFORM_FEE_RATE).toBe(0.025)
    })

    it('FEE_RECIPIENT is samourai-crew multisig', () => {
        expect(FEE_RECIPIENT).toMatch(/^g1/)
        expect(FEE_RECIPIENT.length).toBeGreaterThan(30)
    })

    it('GRC20_FACTORY_PATH is grc20factory realm', () => {
        expect(GRC20_FACTORY_PATH).toBe('gno.land/r/demo/defi/grc20factory')
    })
})

// ── Message Builders ────────────────────────────────────────────

describe('buildCreateTokenMsgs', () => {
    it('builds single msg when initialMint is 0', () => {
        const msgs = buildCreateTokenMsgs('g1caller', 'Foo', 'FOO', 6, 0n, 100n)
        expect(msgs).toHaveLength(1)
        expect(msgs[0].type).toBe('vm/MsgCall')
        expect(msgs[0].value.func).toBe('New')
        expect(msgs[0].value.args).toEqual(['Foo', 'FOO', '6', '0', '100'])
    })

    it('builds two msgs when initialMint > 0 (create + fee transfer)', () => {
        const msgs = buildCreateTokenMsgs('g1caller', 'Foo', 'FOO', 6, 1000n, 100n)
        expect(msgs).toHaveLength(2)
        expect(msgs[0].value.func).toBe('New')
        expect(msgs[1].value.func).toBe('Transfer')
        expect(msgs[1].value.args).toEqual(['FOO', FEE_RECIPIENT, '25']) // 2.5%
    })

    it('does NOT add fee msg when fee rounds to 0', () => {
        const msgs = buildCreateTokenMsgs('g1caller', 'X', 'X', 6, 10n, 0n)
        expect(msgs).toHaveLength(1) // fee of 10 * 25 / 1000 = 0
    })

    it('uses correct factory path', () => {
        const msgs = buildCreateTokenMsgs('g1caller', 'T', 'T', 0, 0n, 0n)
        expect(msgs[0].value.pkg_path).toBe(GRC20_FACTORY_PATH)
    })
})

describe('buildCreateTokenWithAdminMsgs', () => {
    it('includes admin address in NewWithAdmin args', () => {
        const msgs = buildCreateTokenWithAdminMsgs('g1caller', 'Foo', 'FOO', 6, 0n, 100n, 'g1admin')
        expect(msgs).toHaveLength(1)
        expect(msgs[0].value.func).toBe('NewWithAdmin')
        expect(msgs[0].value.args).toEqual(['Foo', 'FOO', '6', '0', '100', 'g1admin'])
    })

    it('adds fee transfer for non-zero mint', () => {
        const msgs = buildCreateTokenWithAdminMsgs('g1caller', 'Foo', 'FOO', 6, 1000n, 100n, 'g1admin')
        expect(msgs).toHaveLength(2)
        expect(msgs[1].value.func).toBe('Transfer')
    })
})

describe('buildMintMsgs', () => {
    it('builds mint + fee transfer', () => {
        const msgs = buildMintMsgs('g1caller', 'FOO', 'g1recipient', 1000n)
        expect(msgs).toHaveLength(2)
        expect(msgs[0].value.func).toBe('Mint')
        expect(msgs[0].value.args).toEqual(['FOO', 'g1recipient', '1000'])
        expect(msgs[1].value.func).toBe('Transfer')
        expect(msgs[1].value.args).toEqual(['FOO', FEE_RECIPIENT, '25']) // 2.5%
    })

    it('skips fee for zero-amount mint', () => {
        const msgs = buildMintMsgs('g1caller', 'FOO', 'g1to', 0n)
        expect(msgs).toHaveLength(1)
    })
})

describe('buildTransferMsg', () => {
    it('builds correct transfer message', () => {
        const msg = buildTransferMsg('g1caller', 'FOO', 'g1to', '500')
        expect(msg.type).toBe('vm/MsgCall')
        expect(msg.value.func).toBe('Transfer')
        expect(msg.value.args).toEqual(['FOO', 'g1to', '500'])
    })
})

describe('buildBurnMsg', () => {
    it('builds correct burn message', () => {
        const msg = buildBurnMsg('g1caller', 'FOO', 'g1from', '100')
        expect(msg.value.func).toBe('Burn')
        expect(msg.value.args).toEqual(['FOO', 'g1from', '100'])
    })
})

describe('buildApproveMsg', () => {
    it('builds correct approve message', () => {
        const msg = buildApproveMsg('g1caller', 'FOO', 'g1spender', '1000')
        expect(msg.value.func).toBe('Approve')
        expect(msg.value.args).toEqual(['FOO', 'g1spender', '1000'])
    })
})

describe('buildFaucetMsg', () => {
    it('builds correct faucet message with only symbol', () => {
        const msg = buildFaucetMsg('g1caller', 'FOO')
        expect(msg.value.func).toBe('Faucet')
        expect(msg.value.args).toEqual(['FOO'])
    })
})

// ── v2.1a: Memba Token Builders ─────────────────────────────────

describe('buildCreateMembaTokenMsgs', () => {
    it('uses MEMBATEST symbol in dev mode', () => {
        const msgs = buildCreateMembaTokenMsgs('g1deployer')
        expect(msgs.length).toBeGreaterThanOrEqual(1)
        const createMsg = msgs[0]
        expect(createMsg.value.func).toBe('New')
        // Symbol should be MEMBATEST (dev) — args[1]
        const symbol = (createMsg.value.args as string[])[1]
        expect(symbol).toMatch(/^MEMBA/) // MEMBA or MEMBATEST
    })

    it('includes fee transfer for non-zero initial mint', () => {
        const msgs = buildCreateMembaTokenMsgs('g1deployer', 1000000n)
        expect(msgs).toHaveLength(2)
        expect(msgs[1].value.func).toBe('Transfer')
    })

    it('uses 6 decimals', () => {
        const msgs = buildCreateMembaTokenMsgs('g1deployer', 0n)
        const decimals = (msgs[0].value.args as string[])[2]
        expect(decimals).toBe('6')
    })
})

// ── v2.1a: formatTokenAmount ────────────────────────────────────

describe('formatTokenAmount', () => {
    it('formats whole token amount', () => {
        expect(formatTokenAmount(1000000n, 6)).toBe('1')
    })

    it('formats fractional amount', () => {
        expect(formatTokenAmount(1500000n, 6)).toBe('1.5')
    })

    it('formats zero', () => {
        expect(formatTokenAmount(0n, 6)).toBe('0')
    })

    it('formats sub-unit amounts', () => {
        expect(formatTokenAmount(123n, 6)).toBe('0.000123')
    })

    it('handles large amounts', () => {
        expect(formatTokenAmount(10000000000000n, 6)).toBe('10000000')
    })
})

// ── Adena Message Conversion ────────────────────────────────────

describe('toAdenaMessages', () => {
    it('converts Amino MsgCall to Adena /vm.m_call format', () => {
        const aminoMsgs = [{
            type: 'vm/MsgCall',
            value: {
                caller: 'g1caller',
                send: '',
                pkg_path: GRC20_FACTORY_PATH,
                func: 'Transfer',
                args: ['FOO', 'g1to', '100'],
            },
        }]
        const result = toAdenaMessages(aminoMsgs)
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe('/vm.m_call')
        expect(result[0].value.caller).toBe('g1caller')
        expect(result[0].value.func).toBe('Transfer')
        expect(result[0].value.args).toEqual(['FOO', 'g1to', '100'])
    })

    it('handles multiple messages', () => {
        const msgs = buildMintMsgs('g1caller', 'FOO', 'g1to', 1000n)
        const adena = toAdenaMessages(msgs)
        expect(adena).toHaveLength(2)
        expect(adena[0].type).toBe('/vm.m_call')
        expect(adena[1].type).toBe('/vm.m_call')
    })

    it('preserves empty send field', () => {
        const msg = buildTransferMsg('g1x', 'FOO', 'g1y', '1')
        const adena = toAdenaMessages([msg])
        expect(adena[0].value.send).toBe('')
    })

    it('throws on non-MsgCall messages (R2-M1 fix)', () => {
        const addPkgMsg = { type: '/vm.m_addpkg', value: { creator: 'g1x', package: {} } }
        expect(() => toAdenaMessages([addPkgMsg])).toThrow('only supports vm/MsgCall')
    })
})
