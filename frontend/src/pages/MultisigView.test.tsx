/**
 * MultisigView.test.tsx — W2.4 money-path coverage.
 *
 * The multisig dashboard routes members into the sign/broadcast flow; these
 * tests pin the auth gate, the pending/completed tab lists, and navigation
 * into ProposeTransaction / TransactionView.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react"
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

const mockAuth = {
    token: { value: "test-token", userAddress: "g1member" },
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
    ENABLE_NATIVE_GNO_MULTISIG: true,
}))

import { MultisigView } from "./MultisigView"
import { api } from "../lib/api"

const MEMBER_A = "g1alice00000000000000000000000000000000"
const MEMBER_B = "g1bob0000000000000000000000000000000000"

function makeMultisig(joined = true) {
    return {
        joined,
        address: MULTISIG,
        chainId: "test-13",
        name: "Treasury Ops",
        threshold: 2,
        membersCount: 2,
        usersAddresses: [MEMBER_A, MEMBER_B],
        pubkeyJson: JSON.stringify({ "@type": "/tm.PubKeyMultisig", threshold: "2", pubkeys: [] }),
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
        fireEvent.click(screen.getByRole("button", { name: "Rename multisig" }))
        expect(screen.getByRole("textbox", { name: "Multisig name" })).toHaveValue("Treasury Ops")
    })

    it("shows pending by default and switches to completed on tab click", async () => {
        await renderView()
        expect(screen.getByRole("tab", { name: /Pending \(1\)/ })).toHaveAttribute("aria-selected", "true")

        fireEvent.click(screen.getByRole("tab", { name: /Completed \(1\)/ }))
        expect(screen.getByRole("tab", { name: /Completed \(1\)/ })).toHaveAttribute("aria-selected", "true")
    })

    // The APG keyboard contract itself is covered in
    // hooks/useTabListKeyboard.test.tsx; these pin that this page is wired
    // through the hook — the roving tabindex only exists if tabProps is spread,
    // and arrow-selection only works if onSelect reaches setTxTab.
    it("gives the tx tabs a roving tabindex (single tab stop)", async () => {
        await renderView()
        expect(screen.getByRole("tab", { name: /Pending \(1\)/ })).toHaveAttribute("tabindex", "0")
        expect(screen.getByRole("tab", { name: /Completed \(1\)/ })).toHaveAttribute("tabindex", "-1")
    })

    it("ArrowRight moves selection from Pending to Completed", async () => {
        await renderView()
        fireEvent.keyDown(screen.getByRole("tab", { name: /Pending \(1\)/ }), { key: "ArrowRight" })
        const completed = screen.getByRole("tab", { name: /Completed \(1\)/ })
        expect(completed).toHaveAttribute("aria-selected", "true")
        expect(completed).toHaveAttribute("tabindex", "0")
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

    it("keeps account details and completed history when pending history fails, then retries just that tab", async () => {
        vi.mocked(api.multisigInfo).mockResolvedValue({ multisig: makeMultisig() } as never)
        let pendingCalls = 0
        vi.mocked(api.transactions).mockImplementation(async (req: { executionState?: number }) => {
            if (req.executionState === 1 && pendingCalls++ === 0) throw new Error("offline")
            return { transactions: req.executionState === 1 ? [makeListedTx(7)] : [makeListedTx(3, "HASH")] } as never
        })
        render(<MultisigView />)
        await screen.findByText("Treasury Ops")
        await screen.findByText("Could not load pending transactions.")
        expect(screen.getAllByText("Member")).toHaveLength(2)
        expect(screen.getByText("12.5 GNOT")).toBeInTheDocument()
        expect(screen.getByText("—")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("tab", { name: /Completed \(1\)/ }))
        expect(screen.getByRole("button", { name: /Open transaction #3/ })).toBeInTheDocument()
        fireEvent.click(screen.getByRole("tab", { name: /Pending \(unavailable\)/ }))
        fireEvent.click(screen.getByRole("button", { name: "Retry pending transactions" }))
        await waitFor(() => expect(screen.getByRole("button", { name: /Open transaction #7/ })).toBeInTheDocument())
        expect(api.multisigInfo).toHaveBeenCalledTimes(1)
    })

    it("discloses a full 50-item page without claiming it is the total", async () => {
        await renderView({ pending: Array.from({ length: 50 }, (_, i) => makeListedTx(i + 1)), executed: [] })
        expect(screen.getByRole("tab", { name: /Pending \(50\+\)/ })).toBeInTheDocument()
        expect(screen.getByText(/Showing the newest 50 pending transactions/)).toBeInTheDocument()
    })

    it("does not offer a proposal for legacy history", async () => {
        vi.mocked(api.multisigInfo).mockResolvedValue({ multisig: { ...makeMultisig(), pubkeyJson: `{}` } } as never)
        vi.mocked(api.transactions).mockResolvedValue({ transactions: [] } as never)
        render(<MultisigView />)
        await screen.findByText("Treasury Ops")
        expect(screen.getByRole("button", { name: "Propose a new transaction" })).toBeDisabled()
        expect(screen.getByText(/Legacy multisig records are read-only history/)).toBeInTheDocument()
        expect(screen.queryByText(/need.*your signature/)).not.toBeInTheDocument()
    })

    it("offers account-info retry when identity read fails", async () => {
        vi.mocked(api.multisigInfo).mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValueOnce({ multisig: makeMultisig() } as never)
        vi.mocked(api.transactions).mockResolvedValue({ transactions: [] } as never)
        render(<MultisigView />)
        await screen.findByText("Could not load this multisig.")
        fireEvent.click(screen.getByRole("button", { name: "Retry account details" }))
        await screen.findByText("Treasury Ops")
    })
})

describe("MultisigView for a member another member registered", () => {
    it("shows its transactions at once, says it is shared, and joins in one click", async () => {
        let joined = false
        vi.mocked(api.multisigInfo).mockImplementation(() => Promise.resolve({ multisig: { ...makeMultisig(joined), name: joined ? "Treasury Ops" : "" } } as never))
        // A member reads the transactions whether or not they joined.
        vi.mocked(api.transactions).mockImplementation((req: { executionState?: number }) =>
            Promise.resolve({ transactions: req.executionState === 1 ? [makeListedTx(2)] : [] } as never))
        vi.mocked(api.createOrJoinMultisig).mockImplementation(() => { joined = true; return Promise.resolve({ joined: true } as never) })
        render(<MultisigView />)
        expect(await screen.findByText("Multisig shared with you")).toBeInTheDocument()
        expect(await screen.findByRole("tab", { name: /Pending \(1\)/ })).toBeInTheDocument()
        expect(screen.getByText("Shared with you: your key is a member, so you can see and sign its transactions.")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Propose a new transaction" })).toBeEnabled()

        fireEvent.click(screen.getByRole("button", { name: "Join to keep it in your accounts" }))
        await waitFor(() => expect(screen.queryByText(/Shared with you: your key is a member/)).toBeNull())
        expect(api.createOrJoinMultisig).toHaveBeenCalledWith(expect.objectContaining({ expectedMultisigAddress: MULTISIG, multisigPubkeyJson: makeMultisig().pubkeyJson }))
    })

    it("shows another member's name, marked with who gave it, until the member names it, and renames from their own empty name", async () => {
        // Not joined either: on its own page the account still shows the name.
        vi.mocked(api.multisigInfo).mockResolvedValue({ multisig: { ...makeMultisig(false), name: "", sharedName: "Reserve", namedBy: "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c" } } as never)
        vi.mocked(api.transactions).mockResolvedValue({ transactions: [] } as never)
        render(<MultisigView />)
        expect(await screen.findByText("Reserve")).toBeInTheDocument()
        expect(screen.getByText("named by g1747t5m…x59c")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Rename multisig" }))
        expect(screen.getByRole("textbox", { name: "Multisig name" })).toHaveValue("")
    })
})
