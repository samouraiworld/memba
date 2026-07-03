/**
 * MultisigView.test.tsx — W2.4 money-path coverage.
 *
 * The multisig dashboard routes members into the sign/broadcast flow; these
 * tests pin the auth gate, the pending/completed tab lists, and navigation
 * into ProposeTransaction / TransactionView.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

const mockNavigate = vi.fn()
vi.mock("../hooks/useNetworkNav", () => ({
    useNetworkNav: () => mockNavigate,
}))

const mockAuth = {
    token: { value: "test-token" },
    isAuthenticated: true,
}
const MULTISIG = "g1multisig000000000000000000000000000000"
vi.mock("react-router-dom", () => ({
    useOutletContext: () => ({ auth: mockAuth, adena: { connected: true, address: "g1member" } }),
    useParams: () => ({ address: MULTISIG }),
}))

vi.mock("../lib/api", () => ({
    api: {
        multisigInfo: vi.fn(),
        transactions: vi.fn(),
        createOrJoinMultisig: vi.fn(),
    },
}))

vi.mock("../hooks/useBalance", () => ({
    useBalance: () => ({ balance: "12.5 GNOT" }),
}))

vi.mock("../lib/config", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../lib/config")>()),
    GNO_CHAIN_ID: "test-13",
}))

import { MultisigView } from "./MultisigView"
import { api } from "../lib/api"

const MEMBER_A = "g1alice00000000000000000000000000000000"
const MEMBER_B = "g1bob0000000000000000000000000000000000"

function makeMultisig() {
    return {
        address: MULTISIG,
        chainId: "test-13",
        name: "Treasury Ops",
        threshold: 2,
        membersCount: 2,
        usersAddresses: [MEMBER_A, MEMBER_B],
        pubkeyJson: JSON.stringify({ value: { threshold: "2", pubkeys: [] } }),
    }
}

function makeListedTx(id: number, finalHash = "") {
    return {
        id,
        createdAt: "2026-07-03T10:00:00Z",
        finalHash,
        multisigAddress: MULTISIG,
        chainId: "test-13",
        msgsJson: "[]",
        feeJson: "{}",
        accountNumber: 1,
        sequence: 1,
        creatorAddress: MEMBER_A,
        threshold: 2,
        membersCount: 2,
        memo: "",
        signatures: [],
        multisigPubkeyJson: "{}",
        type: "send",
        verified: finalHash !== "",
    }
}

async function renderView({ pending = [makeListedTx(7)], executed = [makeListedTx(3, "HASH")] } = {}) {
    vi.mocked(api.multisigInfo).mockResolvedValue({ multisig: makeMultisig() } as never)
    vi.mocked(api.transactions).mockImplementation((req: { executionState?: number }) =>
        // ExecutionState.PENDING = 1, EXECUTED = 2 (proto enum)
        Promise.resolve({ transactions: req.executionState === 1 ? pending : executed } as never))
    render(<MultisigView />)
    await screen.findByText("Treasury Ops")
}

beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.isAuthenticated = true
})

describe("MultisigView", () => {
    it("gates on authentication", () => {
        mockAuth.isAuthenticated = false
        render(<MultisigView />)
        expect(screen.getByText(/Connect your wallet to view multisig details/)).toBeInTheDocument()
        expect(api.multisigInfo).not.toHaveBeenCalled()
    })

    it("renders name, members and balance", async () => {
        await renderView()
        expect(screen.getByText("Treasury Ops")).toBeInTheDocument()
        expect(screen.getByText("12.5 GNOT")).toBeInTheDocument()
        expect(screen.getAllByText("Member")).toHaveLength(2)
    })

    it("shows pending by default and switches to completed on tab click", async () => {
        await renderView()
        expect(screen.getByRole("tab", { name: /Pending \(1\)/ })).toHaveAttribute("aria-selected", "true")

        fireEvent.click(screen.getByRole("tab", { name: /Completed \(1\)/ }))
        expect(screen.getByRole("tab", { name: /Completed \(1\)/ })).toHaveAttribute("aria-selected", "true")
    })

    it("navigates to ProposeTransaction from the action button", async () => {
        await renderView()
        fireEvent.click(screen.getByRole("button", { name: /Propose a new transaction/ }))
        expect(mockNavigate).toHaveBeenCalledWith(`/multisig/${MULTISIG}/propose`)
    })

    it("navigates to TransactionView when a tx row is clicked", async () => {
        await renderView()
        fireEvent.click(screen.getByText("send"))
        expect(mockNavigate).toHaveBeenCalledWith(`/tx/7?ms=${MULTISIG}&chain=test-13`)
    })

    it("renders empty states when there are no transactions", async () => {
        await renderView({ pending: [], executed: [] })
        expect(screen.getByText(/No pending transactions/)).toBeInTheDocument()
    })
})
