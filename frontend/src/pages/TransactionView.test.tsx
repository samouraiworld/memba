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
 * - the completed view surfaces W2.3's backend chain-reconcile: verified
 *   hash → "VERIFIED ON-CHAIN", client-claimed-only → "UNCONFIRMED"
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

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
    GNO_RPC_URL: "https://rpc.test13.testnets.gno.land:443",
    GNO_BECH32_HRP: "g",
    GNO_CHAIN_ID: "test-13",
}))

vi.mock("../lib/dao/realmAddress", () => ({
    pubkeyToAddress: vi.fn((pk: string) =>
        Promise.resolve(pk === "PK_A" ? "g1alice00000000000000000000000000000000" : "g1bob0000000000000000000000000000000000")),
}))

import { TransactionView } from "./TransactionView"
import { api } from "../lib/api"

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
            "@type": "/tm.PubKeyMultisig",
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

beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.isAuthenticated = true
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

    it("shows the broadcast button only at threshold", async () => {
        await renderTx(makeTx({
            signatures: [
                { userAddress: "g1alice00000000000000000000000000000000", value: "s1", bodyBytes: new Uint8Array(), createdAt: "" },
                { userAddress: "g1bob0000000000000000000000000000000000", value: "s2", bodyBytes: new Uint8Array(), createdAt: "" },
            ],
        }))
        expect(screen.getByText("Broadcast to Chain")).toBeInTheDocument()
    })
})

describe("TransactionView — two-step confirmation (W2.4)", () => {
    it("Sign opens the review card and signs NOTHING until Confirm", async () => {
        await renderTx(makeTx())
        fireEvent.click(screen.getByText("Sign Transaction"))

        // Review card visible with the FULL recipient and network match.
        expect(screen.getByRole("alertdialog")).toBeInTheDocument()
        expect(screen.getByText(FULL_RECIPIENT)).toBeInTheDocument()
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
        // Adena broadcast path available and succeeding.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(window as any).adena = {
            BroadcastMultisigTransaction: vi.fn().mockResolvedValue({ status: "success", data: { hash: "ADENAHASH" } }),
        }
        vi.mocked(api.completeTransaction).mockResolvedValue({} as never)
        await renderTx(makeTx({
            signatures: [
                { userAddress: "g1alice00000000000000000000000000000000", value: "s1", bodyBytes: new Uint8Array(), createdAt: "" },
                { userAddress: "g1bob0000000000000000000000000000000000", value: "s2", bodyBytes: new Uint8Array(), createdAt: "" },
            ],
        }))

        fireEvent.click(screen.getByText("Broadcast to Chain"))
        expect(screen.getByText(/costs gas and cannot be undone/)).toBeInTheDocument()
        expect(api.completeTransaction).not.toHaveBeenCalled()

        fireEvent.click(screen.getByText("Confirm & Broadcast"))
        await waitFor(() => expect(api.completeTransaction).toHaveBeenCalled())
        expect(vi.mocked(api.completeTransaction).mock.calls[0][0]).toMatchObject({
            transactionId: 7,
            finalHash: "ADENAHASH",
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (window as any).adena
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

    it("does NOT change the broadcast gate: submitted quorum still enables broadcast", async () => {
        await renderTx(makeTx({ signatures: twoSigs(true, false) }))
        expect(screen.getByText("Broadcast to Chain")).toBeInTheDocument()
    })
})

describe("TransactionView — completion + W2.3 verified flag", () => {
    it("shows VERIFIED ON-CHAIN when the backend reconciled the hash", async () => {
        await renderTx(makeTx({ finalHash: "ABCDEF", verified: true }))
        expect(screen.getByText(/VERIFIED ON-CHAIN/)).toBeInTheDocument()
        expect(screen.queryByText(/UNCONFIRMED/)).not.toBeInTheDocument()
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
