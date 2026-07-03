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
    formatSupply,
    PLATFORM_FEE_RATE,
    FEE_RECIPIENT,
    GRC20_FACTORY_PATH,
    doContractBroadcast,
    setWalletRpcContext,
    setTxConfirmationCallback,
    assertWalletBroadcastSafe,
    UNVERIFIED_CHAIN_ID,
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
        expect(GRC20_FACTORY_PATH).toBe('gno.land/r/samcrew/tokenfactory_v2')
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

    it('builds single msg even when initialMint > 0 (A4: on-chain fee only)', () => {
        const msgs = buildCreateTokenMsgs('g1caller', 'Foo', 'FOO', 6, 1000n, 100n)
        expect(msgs).toHaveLength(1)
        expect(msgs[0].value.func).toBe('New')
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

    it('builds single msg even for non-zero mint (A4: on-chain fee only)', () => {
        const msgs = buildCreateTokenWithAdminMsgs('g1caller', 'Foo', 'FOO', 6, 1000n, 100n, 'g1admin')
        expect(msgs).toHaveLength(1)
        expect(msgs[0].value.func).toBe('NewWithAdmin')
    })
})

describe('buildMintMsgs', () => {
    it('builds single Mint msg (A4: on-chain fee only, no client-side Transfer)', () => {
        const msgs = buildMintMsgs('g1caller', 'FOO', 'g1recipient', 1000n)
        expect(msgs).toHaveLength(1)
        expect(msgs[0].value.func).toBe('Mint')
        expect(msgs[0].value.args).toEqual(['FOO', 'g1recipient', '1000'])
    })

    it('still builds single msg for zero-amount mint', () => {
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

    it('builds single msg even for non-zero initial mint (A4: on-chain fee only)', () => {
        const msgs = buildCreateMembaTokenMsgs('g1deployer', 1000000n)
        expect(msgs).toHaveLength(1)
        expect(msgs[0].value.func).toBe('New')
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

// ── formatSupply (home cards: raw total-supply string → display) ───

describe('formatSupply', () => {
    it('scales by decimals and groups thousands (real CANICULE token)', () => {
        // 102500100 base units, 6 decimals → 102.5001 display
        expect(formatSupply('102500100', 6)).toBe('102.5001')
    })

    it('adds thousand separators to large whole supplies', () => {
        expect(formatSupply('1000000000000', 6)).toBe('1,000,000')
    })

    it('returns null for a zero or unparsable supply (omit, never show "0")', () => {
        expect(formatSupply('0', 6)).toBeNull()
        expect(formatSupply('', 6)).toBeNull()
        expect(formatSupply('not-a-number', 6)).toBeNull()
    })

    it('handles 0 decimals (whole-unit token)', () => {
        expect(formatSupply('21000000', 0)).toBe('21,000,000')
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

    it('handles the single-message builders correctly', () => {
        const msgs = buildMintMsgs('g1caller', 'FOO', 'g1to', 1000n)
        const adena = toAdenaMessages(msgs)
        expect(adena).toHaveLength(1)
        expect(adena[0].type).toBe('/vm.m_call')
    })

    it('preserves empty send field', () => {
        const msg = buildTransferMsg('g1x', 'FOO', 'g1y', '1')
        const adena = toAdenaMessages([msg])
        expect(adena[0].value.send).toBe('')
    })

    it('passes /vm.m_addpkg and bank/MsgSend through unchanged (W2.1)', () => {
        const addPkgMsg = { type: '/vm.m_addpkg', value: { creator: 'g1x', package: {} } }
        const sendMsg = {
            type: 'bank/MsgSend',
            value: { from_address: 'g1x', to_address: 'g1x', amount: [{ denom: 'ugnot', amount: '1' }] },
        }
        expect(toAdenaMessages([addPkgMsg, sendMsg])).toEqual([addPkgMsg, sendMsg])
    })

    it('throws on unknown message types (R2-M1 fix)', () => {
        const bogus = { type: 'vm/MsgRun', value: {} }
        expect(() => toAdenaMessages([bogus])).toThrow('unsupported message type')
    })
})

describe('doContractBroadcast — wrong-chain guard (defense-in-depth)', () => {
    // App network in the test env is the default (test13, chainId "test-13").
    // A wallet reporting a different chainId must be blocked before any broadcast.
    it('blocks broadcast when the wallet chainId != Memba network', async () => {
        setTxConfirmationCallback(() => Promise.resolve(true))
        setWalletRpcContext('https://rpc.gnoland1.samourai.live:443', true, 'gnoland1')
        await expect(doContractBroadcast([], 'memo')).rejects.toThrow(/wallet is on chain "gnoland1"/)
        setTxConfirmationCallback(null)
        setWalletRpcContext(null, false, null)
    })

    it('passes the chain guard when the wallet chainId matches (proceeds to wallet check)', async () => {
        setTxConfirmationCallback(() => Promise.resolve(true))
        setWalletRpcContext('https://rpc.test13.testnets.gno.land:443', true, 'test-13')
        // matches → not blocked by the chain guard; fails later (no window.adena in jsdom)
        await expect(doContractBroadcast([], 'memo')).rejects.toThrow(/Adena wallet not available/)
        setTxConfirmationCallback(null)
        setWalletRpcContext(null, false, null)
    })
})

// ── W2.1: shared guard + deploy gas ───────────────────────────

describe('assertWalletBroadcastSafe — shared guard for non-DoContract transports', () => {
    it('throws on an untrusted RPC', () => {
        setWalletRpcContext('https://rpc.evil.example:443', false, 'test-13')
        expect(() => assertWalletBroadcastSafe()).toThrow(/untrusted RPC/)
        setWalletRpcContext(null, false, null)
    })

    it('throws on a wrong-chain wallet', () => {
        setWalletRpcContext('https://rpc.test13.testnets.gno.land:443', true, 'gnoland1')
        expect(() => assertWalletBroadcastSafe()).toThrow(/wallet is on chain "gnoland1"/)
        setWalletRpcContext(null, false, null)
    })

    it('fails CLOSED on the unverified-chain sentinel with reconnect guidance', () => {
        setWalletRpcContext('https://rpc.test13.testnets.gno.land:443', true, UNVERIFIED_CHAIN_ID)
        expect(() => assertWalletBroadcastSafe()).toThrow(/could not be verified/)
        setWalletRpcContext(null, false, null)
    })

    it('passes on a trusted RPC with a matching chain', () => {
        setWalletRpcContext('https://rpc.test13.testnets.gno.land:443', true, 'test-13')
        expect(() => assertWalletBroadcastSafe()).not.toThrow()
        setWalletRpcContext(null, false, null)
    })
})

describe('doContractBroadcast — deploy gas budget (W2.1)', () => {
    it('uses the elevated deploy budget for { gas: "deploy" } and the normal one otherwise', async () => {
        setTxConfirmationCallback(() => Promise.resolve(true))
        setWalletRpcContext('https://rpc.test13.testnets.gno.land:443', true, 'test-13')
        const calls: Array<{ gasWanted: number }> = []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(window as any).adena = {
            DoContract: (arg: { gasWanted: number }) => {
                calls.push(arg)
                return Promise.resolve({ status: 'success', data: { hash: 'h' } })
            },
        }
        const addPkgMsg = { type: '/vm.m_addpkg', value: { creator: 'g1x', package: {} } }
        await doContractBroadcast([addPkgMsg], 'deploy memo', { gas: 'deploy' })
        await doContractBroadcast([addPkgMsg], 'call memo')
        expect(calls).toHaveLength(2)
        // deployWanted is strictly larger than the normal budget (5x default).
        expect(calls[0].gasWanted).toBeGreaterThan(calls[1].gasWanted)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (window as any).adena
        setTxConfirmationCallback(null)
        setWalletRpcContext(null, false, null)
    })
})
