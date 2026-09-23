/**
 * TransactionView.test.tsx — W2.4 money-path coverage.
 *
 * The multisig sign/broadcast flow moves real funds; these tests pin the
 * confirmation rigor added in W2.4 (mirroring the DAO-vote pattern):
 * - sign/broadcast are TWO-step: button opens a review card; nothing is
 *   signed or broadcast until Confirm
 * - the review card shows the FULL recipient (truncation hides exactly the
 *   bytes an address-poisoning attack forges), the fee, and a network
 *   match/mismatch indicator against the app's configured chain
 * - the completed view surfaces the backend's verified flag: a native
 *   receipt-verified hash → "VERIFIED ON-CHAIN"; legacy (non-native) records
 *   are read-only history and never claim their hash proves this transaction
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"

// Fresh client per render: retry off (a failing query must fail now, not after
// backoff) and zero cache sharing between tests.
function render(ui: ReactElement) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const mockNavigate = vi.fn()
vi.mock("../hooks/useNetworkNav", () => ({
    useNetworkNav: () => mockNavigate,
}))

const mockAdena = {
    connected: true,
    address: "g1carol000000000000000000000000000000000",
    signArbitrary: vi.fn(),
}
const mockAuth = {
    token: { value: "test-token" },
    isAuthenticated: true,
}
vi.mock("react-router-dom", () => ({
    useOutletContext: () => ({ adena: mockAdena, auth: mockAuth }),
    useParams: () => ({ id: "7" }),
}))

vi.mock("../lib/api", () => ({
    api: {
        getTransaction: vi.fn(),
        signTransaction: vi.fn(),
        completeTransaction: vi.fn(),
    },
}))

vi.mock("../lib/quests", () => ({
    completeQuest: vi.fn(),
}))

// W2.1 guard — a no-op here; its own tests live in grc20.test.ts.
vi.mock("../lib/grc20", () => ({
    assertWalletBroadcastSafe: vi.fn(),
}))

vi.mock("../lib/config", () => ({
    API_BASE_URL: "https://memba-api.test",
    GNO_RPC_URL: "https://rpc.test13.testnets.gno.land:443",
    GNO_BECH32_HRP: "g",
    GNO_CHAIN_ID: "test-13",
    ENABLE_NATIVE_GNO_MULTISIG: true,
}))

vi.mock("../lib/nativeMultisigBroadcast", async importOriginal => ({
    ...await importOriginal<typeof import("../lib/nativeMultisigBroadcast")>(),
    broadcastNativeTransaction: vi.fn(),
}))

vi.mock("../lib/dao/realmAddress", () => ({
    pubkeyToAddress: vi.fn((pk: string) =>
        Promise.resolve(pk === "PK_A" ? "g1alice00000000000000000000000000000000" : "g1bob0000000000000000000000000000000000")),
}))

import { TransactionView } from "./TransactionView"
import { api } from "../lib/api"
import { broadcastNativeTransaction } from "../lib/nativeMultisigBroadcast"
import { clearNativeReceipt, nativeReceiptKey, readNativeReceipt, saveNativeReceipt } from "../lib/nativeReceipt"

const FULL_RECIPIENT = "g1recipientfulladdress0000000000000000xy"

function makeTx(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        id: 7,
        createdAt: "2026-07-03T10:00:00Z",
        finalHash: "",
        multisigAddress: "g1multisig000000000000000000000000000000",
        chainId: "test-13",
        msgsJson: JSON.stringify([{
            type: "/bank.MsgSend",
            value: {
                from_address: "g1multisig000000000000000000000000000000",
                to_address: FULL_RECIPIENT,
                amount: [{ denom: "ugnot", amount: "5000000" }],
            },
        }]),
        feeJson: JSON.stringify({ gas_wanted: "200000", gas_fee: "10000ugnot" }),
        accountNumber: 12,
        sequence: 3,
        creatorAddress: "g1alice00000000000000000000000000000000",
        threshold: 2,
        membersCount: 3,
        memo: "",
        signatures: [],
        multisigPubkeyJson: JSON.stringify({
            type: "tendermint/PubKeyMultisigThreshold",
            value: { threshold: "2", pubkeys: [{ value: "PK_A" }, { value: "PK_B" }] },
        }),
        type: "send",
        verified: false,
        ...overrides,
    }
}

async function renderTx(tx: ReturnType<typeof makeTx>) {
    vi.mocked(api.getTransaction).mockResolvedValue({ transaction: tx } as never)
    render(<TransactionView />)
    await screen.findByText("TX #7")
}

it("does not expose native broadcast merely because submitted signatures reach threshold", async () => {
    await renderTx(makeTx({ multisigPubkeyJson: '{"@type":"/tm.PubKeyMultisig"}', signatures: [{ userAddress: "one", value: "bad" }, { userAddress: "two", value: "bad" }] }))
    expect(screen.queryByText("Broadcast to Chain")).not.toBeInTheDocument()
})

beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.mocked(broadcastNativeTransaction).mockReset()
    mockAuth.isAuthenticated = true
})

function makeNativeTx() {
    return makeTx({
        multisigPubkeyJson: '{"@type":"/tm.PubKeyMultisig"}',
        msgsJson: JSON.stringify([{ "@type": "/bank.MsgSend", from_address: "g1multisig000000000000000000000000000000", to_address: FULL_RECIPIENT, amount: "5000000ugnot" }]),
        feeJson: '{"gas_wanted":"10000000","gas_fee":"1000000ugnot"}',
    })
}
const receiptKey = () => nativeReceiptKey(makeNativeTx() as never, mockAdena.address, "https://memba-api.test")
const HASH = "A".repeat(64)
const nativeResponse = () => ({ transaction: makeNativeTx(), nativeTxBytes: new Uint8Array([1, 2, 3]) })

describe("native confirmation and receipt recovery", () => {
    beforeEach(() => clearNativeReceipt(receiptKey()))

    it("shows native amount and monetary fee before signing the unchanged payload", async () => {
        mockAdena.signArbitrary.mockResolvedValue("sig")
        await renderTx(makeNativeTx())
        fireEvent.click(screen.getByText("Sign Transaction"))
        const card = within(screen.getByRole("alertdialog"))
        expect(card.getByText("Send 5 GNOT")).toBeInTheDocument()
        expect(card.getByText("1 GNOT (gas: 10000000)")).toBeInTheDocument()
        fireEvent.click(card.getByText("Confirm & Sign"))
        await waitFor(() => expect(mockAdena.signArbitrary).toHaveBeenCalledOnce())
        const doc = JSON.parse(mockAdena.signArbitrary.mock.calls[0][0])
        expect(doc.msgs[0].amount).toBe("5000000ugnot")
        expect(doc.fee.gas_fee).toBe("1000000ugnot")
    })

    it.each([
        { feeJson: '{"gas_wanted":"1","gas_fee":{"amount":"99"}}' },
        { msgsJson: '[{"@type":"/bank.MsgSend","amount":9007199254740993}]' },
    ])("blocks signing and broadcasting monetary values it cannot display: %j", async bad => {
        vi.mocked(api.getTransaction).mockResolvedValue({ ...nativeResponse(), transaction: { ...makeNativeTx(), ...bad } } as never)
        render(<TransactionView />)
        await screen.findByText("TX #7")
        expect(screen.getByText("Sign Transaction")).toBeDisabled()
        expect(screen.getByText("Broadcast to Chain")).toBeDisabled()
        expect(screen.getByRole("alert")).toHaveTextContent("Cannot safely display")
    })

    it("persists the successful hash, survives remount, and retries only receipt verification", async () => {
        vi.mocked(api.getTransaction).mockResolvedValue(nativeResponse() as never)
        vi.mocked(broadcastNativeTransaction).mockResolvedValue(HASH)
        vi.mocked(api.completeTransaction).mockRejectedValueOnce(new Error("receipt unavailable")).mockImplementationOnce(async () => {
            vi.mocked(api.getTransaction).mockResolvedValue({ transaction: { ...makeNativeTx(), finalHash: HASH, verified: true } } as never)
            return {} as never
        })
        const first = render(<TransactionView />)
        await screen.findByText("TX #7")
        fireEvent.click(screen.getByText("Broadcast to Chain"))
        fireEvent.click(screen.getByText("Confirm & Broadcast"))
        await screen.findByText("receipt unavailable")
        expect(readNativeReceipt(receiptKey())).toBe(HASH)
        expect(screen.getByText(HASH)).toBeInTheDocument()
        expect(screen.queryByText("Broadcast to Chain")).not.toBeInTheDocument()
        first.unmount()
        // Recovery must not need an aggregate, nor any new signing/broadcast.
        vi.mocked(api.getTransaction).mockResolvedValue({ transaction: makeNativeTx(), nativeTxBytes: new Uint8Array() } as never)
        render(<TransactionView />)
        await screen.findByText("Retry receipt verification")
        fireEvent.click(screen.getByText("Retry receipt verification"))
        await screen.findByText(/VERIFIED ON-CHAIN/)
        expect(broadcastNativeTransaction).toHaveBeenCalledTimes(1)
        expect(api.completeTransaction).toHaveBeenCalledTimes(2)
        expect(vi.mocked(api.completeTransaction).mock.calls[1][0]).toMatchObject({ transactionId: 7, finalHash: HASH })
        expect(readNativeReceipt(receiptKey())).toBe("")
    })

    it("keeps recovery available across repeated completion failures and a stale refresh", async () => {
        saveNativeReceipt(receiptKey(), HASH)
        vi.mocked(api.getTransaction).mockResolvedValue(nativeResponse() as never)
        vi.mocked(api.completeTransaction).mockRejectedValueOnce(new Error("still unavailable")).mockResolvedValueOnce({} as never)
        render(<TransactionView />)
        await screen.findByText("Retry receipt verification")
        fireEvent.click(screen.getByText("Retry receipt verification"))
        await screen.findByText("still unavailable")
        fireEvent.click(screen.getByText("Retry receipt verification"))
        await waitFor(() => expect(api.completeTransaction).toHaveBeenCalledTimes(2))
        await screen.findByText("Retry receipt verification")
        expect(readNativeReceipt(receiptKey())).toBe(HASH)
        expect(broadcastNativeTransaction).not.toHaveBeenCalled()
        expect(screen.queryByText("Broadcast to Chain")).not.toBeInTheDocument()
    })

    it("reconciles a lost completion response from server state without repeating Complete", async () => {
        saveNativeReceipt(receiptKey(), HASH)
        vi.mocked(api.getTransaction).mockResolvedValueOnce(nativeResponse() as never).mockResolvedValue({ transaction: { ...makeNativeTx(), finalHash: HASH, verified: true } } as never)
        render(<TransactionView />)
        await screen.findByText("Retry receipt verification")
        fireEvent.click(screen.getByText("Retry receipt verification"))
        await screen.findByText(/VERIFIED ON-CHAIN/)
        expect(api.completeTransaction).not.toHaveBeenCalled()
        expect(broadcastNativeTransaction).not.toHaveBeenCalled()
        expect(readNativeReceipt(receiptKey())).toBe("")
    })

    it("fails before broadcasting if browser storage cannot persist recovery", async () => {
        vi.mocked(api.getTransaction).mockResolvedValue(nativeResponse() as never)
        vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("quota") })
        render(<TransactionView />)
        await screen.findByText("TX #7")
        fireEvent.click(screen.getByText("Broadcast to Chain"))
        fireEvent.click(screen.getByText("Confirm & Broadcast"))
        await screen.findByText(/Enable browser storage/)
        expect(broadcastNativeTransaction).not.toHaveBeenCalled()
        expect(api.completeTransaction).not.toHaveBeenCalled()
    })

    it("does not treat a corrupted receipt hint as completion or allow rebroadcast", async () => {
        localStorage.setItem(receiptKey(), "not-a-hash")
        await renderTx(makeNativeTx())
        expect(screen.getByText("Retry receipt verification")).toBeDisabled()
        expect(screen.queryByText("Broadcast to Chain")).not.toBeInTheDocument()
        expect(screen.queryByText(/VERIFIED ON-CHAIN/)).not.toBeInTheDocument()
    })

    it("refuses to act when the refreshed immutable transaction differs", async () => {
        vi.mocked(api.getTransaction).mockResolvedValueOnce(nativeResponse() as never).mockResolvedValue({ ...nativeResponse(), transaction: { ...makeNativeTx(), sequence: 99 } } as never)
        render(<TransactionView />)
        await screen.findByText("TX #7")
        fireEvent.click(screen.getByText("Broadcast to Chain"))
        fireEvent.click(screen.getByText("Confirm & Broadcast"))
        await screen.findByText(/Transaction identity changed/)
        expect(broadcastNativeTransaction).not.toHaveBeenCalled()
        expect(api.completeTransaction).not.toHaveBeenCalled()
    })

    it("recovery still enforces the selected chain", async () => {
        const tx = { ...makeNativeTx(), chainId: "wrong-chain" }
        const otherKey = nativeReceiptKey(tx as never, mockAdena.address, "https://memba-api.test")
        saveNativeReceipt(otherKey, HASH)
        await renderTx(tx)
        fireEvent.click(screen.getByText("Retry receipt verification"))
        await screen.findByText(/Stored transaction chain does not match/)
        expect(broadcastNativeTransaction).not.toHaveBeenCalled()
        expect(api.completeTransaction).not.toHaveBeenCalled()
        clearNativeReceipt(otherKey)
    })

    it("keeps a volatile hash and warns if persistence fails only after broadcast", async () => {
        vi.mocked(api.getTransaction).mockResolvedValue(nativeResponse() as never)
        vi.mocked(broadcastNativeTransaction).mockImplementation(async () => {
            vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("quota") })
            return HASH
        })
        vi.mocked(api.completeTransaction).mockRejectedValue(new Error("receipt unavailable"))
        render(<TransactionView />)
        await screen.findByText("TX #7")
        fireEvent.click(screen.getByText("Broadcast to Chain"))
        fireEvent.click(screen.getByText("Confirm & Broadcast"))
        await screen.findByText(/Browser storage failed after broadcast/)
        await screen.findByText("Retry receipt verification")
        expect(screen.getByText(HASH)).toBeInTheDocument()
        fireEvent.click(screen.getByText("Retry receipt verification"))
        await waitFor(() => expect(api.completeTransaction).toHaveBeenCalledTimes(2))
        expect(broadcastNativeTransaction).toHaveBeenCalledTimes(1)
    })
})

describe("TransactionView — rendering", () => {
    it("renders parsed message, details and signature progress for a pending tx", async () => {
        await renderTx(makeTx())
        expect(screen.getByText(/Send 5 GNOT/)).toBeInTheDocument()
        expect(screen.getByText("test-13")).toBeInTheDocument()
        expect(screen.getByText("Sign Transaction")).toBeInTheDocument()
        // Broadcast requires threshold — 0/2 sigs, so it must NOT show.
        expect(screen.queryByText("Broadcast to Chain")).not.toBeInTheDocument()
    })

    it("never offers broadcast/complete for a legacy transaction, even at quorum", async () => {
        await renderTx(makeTx({
            signatures: [
                { userAddress: "g1alice00000000000000000000000000000000", value: "s1", bodyBytes: new Uint8Array(), createdAt: "", verified: true },
                { userAddress: "g1bob0000000000000000000000000000000000", value: "s2", bodyBytes: new Uint8Array(), createdAt: "", verified: true },
            ],
        }))
        expect(screen.queryByText("Broadcast to Chain")).not.toBeInTheDocument()
        expect(screen.queryByText("Confirm & Broadcast")).not.toBeInTheDocument()
        expect(screen.getByText(/Legacy multisig records are read-only history/)).toBeInTheDocument()
        // Signing and export stay available.
        expect(screen.getByText("Sign Transaction")).toBeInTheDocument()
        expect(screen.getByText("Export Unsigned TX")).toBeInTheDocument()
        expect(api.completeTransaction).not.toHaveBeenCalled()
    })

    it("shows the native broadcast button once the aggregate is ready", async () => {
        clearNativeReceipt(receiptKey())
        vi.mocked(api.getTransaction).mockResolvedValue(nativeResponse() as never)
        render(<TransactionView />)
        await screen.findByText("TX #7")
        expect(screen.getByText("Broadcast to Chain")).toBeInTheDocument()
        expect(screen.queryByText(/Legacy multisig records are read-only history/)).not.toBeInTheDocument()
    })
})

describe("TransactionView — two-step confirmation (W2.4)", () => {
    it("Sign opens the review card and signs NOTHING until Confirm", async () => {
        await renderTx(makeTx())
        fireEvent.click(screen.getByText("Sign Transaction"))

        // Review card visible with the FULL recipient and network match.
        expect(screen.getByRole("alertdialog")).toBeInTheDocument()
        expect(within(screen.getByRole("alertdialog")).getByText(FULL_RECIPIENT)).toBeInTheDocument()
        expect(screen.getByText(/matches this app's network/)).toBeInTheDocument()
        // No wallet interaction yet.
        expect(mockAdena.signArbitrary).not.toHaveBeenCalled()
        expect(api.signTransaction).not.toHaveBeenCalled()
    })

    it("Cancel closes the review card without signing", async () => {
        await renderTx(makeTx())
        fireEvent.click(screen.getByText("Sign Transaction"))
        fireEvent.click(screen.getByText("Cancel"))
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
        expect(mockAdena.signArbitrary).not.toHaveBeenCalled()
    })

    it("Confirm & Sign signs the canonical doc and submits the signature", async () => {
        mockAdena.signArbitrary.mockResolvedValue("base64sig")
        vi.mocked(api.signTransaction).mockResolvedValue({} as never)
        await renderTx(makeTx())

        fireEvent.click(screen.getByText("Sign Transaction"))
        fireEvent.click(screen.getByText("Confirm & Sign"))

        await waitFor(() => expect(api.signTransaction).toHaveBeenCalled())
        const signedDoc = JSON.parse(mockAdena.signArbitrary.mock.calls[0][0])
        expect(signedDoc.chain_id).toBe("test-13")
        expect(signedDoc.sequence).toBe("3")
        expect(vi.mocked(api.signTransaction).mock.calls[0][0]).toMatchObject({
            transactionId: 7,
            signature: "base64sig",
        })
    })

    it("warns loudly when the tx targets a DIFFERENT chain than the app", async () => {
        await renderTx(makeTx({ chainId: "test-12" }))
        fireEvent.click(screen.getByText("Sign Transaction"))
        expect(screen.getByText(/DIFFERENT from this app's network \(test-13\)/)).toBeInTheDocument()
    })

    it("Broadcast opens the review card with broadcast wording and runs only on Confirm", async () => {
        clearNativeReceipt(receiptKey())
        vi.mocked(api.getTransaction).mockResolvedValue(nativeResponse() as never)
        vi.mocked(broadcastNativeTransaction).mockResolvedValue(HASH)
        vi.mocked(api.completeTransaction).mockResolvedValue({} as never)
        render(<TransactionView />)
        await screen.findByText("TX #7")

        fireEvent.click(screen.getByText("Broadcast to Chain"))
        expect(screen.getByText(/costs gas and cannot be undone/)).toBeInTheDocument()
        expect(broadcastNativeTransaction).not.toHaveBeenCalled()
        expect(api.completeTransaction).not.toHaveBeenCalled()

        fireEvent.click(screen.getByText("Confirm & Broadcast"))
        await waitFor(() => expect(api.completeTransaction).toHaveBeenCalled())
        expect(vi.mocked(api.completeTransaction).mock.calls[0][0]).toMatchObject({
            transactionId: 7,
            finalHash: HASH,
        })
        clearNativeReceipt(receiptKey())
    })
})

describe("TransactionView — per-signature verified (A3 log-only window)", () => {
    // During the log-only rollout (MEMBA_ENFORCE_MULTISIG_SIG_VERIFY unset) the
    // backend stores signatures that FAILED server-side verification. The UI
    // must distinguish verified from merely-submitted so quorum is not
    // misrepresented — while leaving the broadcast gate itself unchanged
    // (gate-on-verified is blocked on the A3 sign-byte fix).
    const twoSigs = (aliceVerified: boolean, bobVerified: boolean) => [
        { userAddress: "g1alice00000000000000000000000000000000", value: "s1", bodyBytes: new Uint8Array(), createdAt: "", verified: aliceVerified },
        { userAddress: "g1bob0000000000000000000000000000000000", value: "s2", bodyBytes: new Uint8Array(), createdAt: "", verified: bobVerified },
    ]

    it("shows verified vs submitted counts in the signature progress", async () => {
        await renderTx(makeTx({ signatures: twoSigs(true, false) }))
        expect(screen.getByText("1/2 verified")).toBeInTheDocument()
        expect(screen.getByText("2 submitted")).toBeInTheDocument()
    })

    it("labels each signer row Verified or Unverified", async () => {
        await renderTx(makeTx({ signatures: twoSigs(true, false) }))
        expect(screen.getByText("Verified")).toBeInTheDocument()
        expect(screen.getByText("Unverified")).toBeInTheDocument()
    })

    it("disambiguates 'Unverified' — legacy rows are expected, not failures", async () => {
        await renderTx(makeTx({ signatures: twoSigs(true, false) }))
        expect(screen.getByText("Unverified")).toHaveAttribute(
            "title",
            expect.stringContaining("predates server-side verification"),
        )
        expect(screen.getByText("Verified")).toHaveAttribute(
            "title",
            expect.stringContaining("checked out"),
        )
    })

    it("flags a quorum that contains unverified signatures", async () => {
        await renderTx(makeTx({ signatures: twoSigs(true, false) }))
        expect(screen.getByText(/quorum includes unverified signatures/i)).toBeInTheDocument()
        expect(screen.queryByText("Ready to broadcast")).not.toBeInTheDocument()
    })

    it("shows Ready to broadcast when the quorum is fully verified", async () => {
        await renderTx(makeTx({ signatures: twoSigs(true, true) }))
        expect(screen.getByText("2/2 verified")).toBeInTheDocument()
        expect(screen.getByText("Ready to broadcast")).toBeInTheDocument()
        expect(screen.queryByText(/quorum includes unverified/i)).not.toBeInTheDocument()
    })

    it("a submitted quorum does not enable broadcast for a legacy transaction", async () => {
        await renderTx(makeTx({ signatures: twoSigs(true, false) }))
        expect(screen.queryByText("Broadcast to Chain")).not.toBeInTheDocument()
    })
})

describe("TransactionView — completion + verified flag", () => {
    it("shows VERIFIED ON-CHAIN for a native receipt-verified hash", async () => {
        await renderTx(makeTx({ multisigPubkeyJson: '{"@type":"/tm.PubKeyMultisig"}', finalHash: HASH, verified: true }))
        expect(screen.getByText(/VERIFIED ON-CHAIN/)).toBeInTheDocument()
        expect(screen.queryByText(/UNCONFIRMED/)).not.toBeInTheDocument()
        expect(screen.queryByText(/not verified against this transaction/)).not.toBeInTheDocument()
    })

    it("does not claim a legacy record's stored hash proves this transaction", async () => {
        await renderTx(makeTx({ finalHash: "ABCDEF", verified: true }))
        expect(screen.getByText(/Hash recorded \(not verified against this transaction\)/)).toBeInTheDocument()
        expect(screen.queryByText(/VERIFIED ON-CHAIN/)).not.toBeInTheDocument()
    })

    it("shows UNCONFIRMED for a client-claimed hash the chain didn't confirm", async () => {
        await renderTx(makeTx({ finalHash: "ABCDEF", verified: false }))
        expect(screen.getByText(/UNCONFIRMED/)).toBeInTheDocument()
        expect(screen.queryByText(/VERIFIED ON-CHAIN/)).not.toBeInTheDocument()
    })

    it("hides sign/broadcast actions once completed", async () => {
        await renderTx(makeTx({ finalHash: "ABCDEF", verified: true }))
        expect(screen.queryByText("Sign Transaction")).not.toBeInTheDocument()
        expect(screen.queryByText("Broadcast to Chain")).not.toBeInTheDocument()
    })
})

describe("TransactionView — what a co-signer reads", () => {
    const TARGET = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"
    const callTx = (args: string[], memo = "") => makeTx({
        memo,
        msgsJson: JSON.stringify([{ type: "vm/MsgCall", value: { caller: "g1multisig000000000000000000000000000000", send: "", pkg_path: "gno.land/r/demo/bank", func: "Transfer", args } }]),
    })

    it("shows the recipient in full with a copy button on the page and in the review card", async () => {
        await renderTx(makeTx())
        const onPage = screen.getByText(FULL_RECIPIENT)
        expect(onPage).toHaveAttribute("dir", "ltr")
        expect(screen.getByRole("button", { name: `Copy ${FULL_RECIPIENT}` })).toBeInTheDocument()
        fireEvent.click(screen.getByText("Sign Transaction"))
        expect(within(screen.getByRole("alertdialog")).getByText(FULL_RECIPIENT)).toBeInTheDocument()
    })

    it("shows each argument on its own, so a comma inside one cannot pass for two", async () => {
        await renderTx(callTx(["1, 2", TARGET]))
        fireEvent.click(screen.getByText("Sign Transaction"))
        const dialog = within(screen.getByRole("alertdialog"))
        expect(dialog.getByText("1, 2", { selector: ".tx-confirm-arg" })).toBeInTheDocument()
        expect(dialog.getByText(TARGET, { selector: ".tx-confirm-arg" })).toBeInTheDocument()
        expect(dialog.getByRole("button", { name: `Copy ${TARGET}` })).toBeInTheDocument()
    })

    it("reveals invisible characters and pins right-to-left text in arguments and the memo to its signed order", async () => {
        await renderTx(callTx(["100 \u05D0 5", "pay\u202Eevil"], "memo\u200Bnote"))
        fireEvent.click(screen.getByText("Sign Transaction"))
        const dialog = within(screen.getByRole("alertdialog"))
        const rtl = dialog.getByText("100 \u05D0 5", { selector: ".tx-confirm-arg" })
        expect(rtl).toHaveAttribute("dir", "ltr")
        expect(rtl).toHaveClass("signing-text")
        expect(dialog.getByText("pay[U+202E]evil", { selector: ".tx-confirm-arg" })).toBeInTheDocument()
        // The memo appears in the details and in the review card.
        expect(dialog.getByText("memo[U+200B]note")).toBeInTheDocument()
        for (const memo of screen.getAllByText("memo[U+200B]note")) {
            expect(memo).toHaveAttribute("dir", "ltr")
            expect(memo).toHaveClass("signing-text")
        }
        expect(document.body.textContent).not.toMatch(/[\u202E\u200B]/)
    })
})

