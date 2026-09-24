/**
 * AttestationPanel.test.tsx — the panel only offers vouchers the active chain
 * will accept, and broadcasts RecordCompletion sized for mainnet.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { create } from "@bufbuild/protobuf"
import { AttestationVoucherSchema } from "../../gen/memba/v1/memba_pb"

const REALM = "gno.land/r/samcrew/memba_quest_attestation_v1"
const KEY = "4dbf5a291e6a363780a1dfe75671562d894240f4c138129f336116a2adc795ba"
const ADDR = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"

// The allowlist gate reads the active network; pin it to mainnet.
vi.mock("../../lib/config", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../lib/config")>()
    return { ...actual, isRealmValid: (p: string) => actual.isRealmValidOn("mainnet", p) }
})

const fetchVouchers = vi.fn()
const fetchSigner = vi.fn()
const fetchRecorded = vi.fn()
vi.mock("../../lib/attestation", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/attestation")>()),
    fetchAttestationVouchers: (...a: unknown[]) => fetchVouchers(...a),
    fetchRealmSignerHex: (...a: unknown[]) => fetchSigner(...a),
    fetchRecordedQuestIds: (...a: unknown[]) => fetchRecorded(...a),
}))

const broadcast = vi.fn()
vi.mock("../../lib/grc20", () => ({
    doContractBroadcast: (...a: unknown[]) => broadcast(...a),
}))

import { AttestationPanel } from "./AttestationPanel"

const voucher = create(AttestationVoucherSchema, { questId: "connect-wallet", xp: 10, nonce: "ab12", sigHex: "cd34" })

function renderPanel() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={qc}>
            <AttestationPanel address={ADDR} />
        </QueryClientProvider>,
    )
}

describe("AttestationPanel", () => {
    beforeEach(() => {
        fetchVouchers.mockReset().mockResolvedValue({ vouchers: [voucher], realmPath: REALM, signerPubkeyHex: KEY })
        fetchSigner.mockReset().mockResolvedValue(KEY)
        fetchRecorded.mockReset().mockResolvedValue(new Set())
        broadcast.mockReset().mockResolvedValue({ hash: "h" })
    })

    it("broadcasts RecordCompletion to the backend's realm with a deposit cap and the measured gas limit", async () => {
        renderPanel()
        fireEvent.click(await screen.findByRole("button", { name: "Attest on-chain" }))
        await waitFor(() => expect(broadcast).toHaveBeenCalledTimes(1))
        const [msgs, , opts] = broadcast.mock.calls[0]
        expect(msgs).toEqual([{
            type: "vm/MsgCall",
            value: {
                caller: ADDR,
                send: "",
                pkg_path: REALM,
                func: "RecordCompletion",
                args: [ADDR, "connect-wallet", "10", "ab12", "cd34"],
                max_deposit: "1600000ugnot",
            },
        }])
        expect(opts).toEqual({ gasWanted: 50_000_000, retry: false })
        expect(fetchSigner).toHaveBeenCalledWith(REALM)
    })

    it("discloses the storage deposit cap", async () => {
        renderPanel()
        expect(await screen.findByText(/storage deposit of up to 1\.6 GNOT per quest/)).toBeInTheDocument()
    })

    it("stays hidden when the realm's signer is not the backend's key", async () => {
        fetchSigner.mockResolvedValue("")
        const { container } = renderPanel()
        await waitFor(() => expect(fetchSigner).toHaveBeenCalled())
        await waitFor(() => expect(fetchRecorded).toHaveBeenCalled())
        expect(container).toBeEmptyDOMElement()
    })

    it("stays hidden when the backend's realm is not allowlisted on the active network", async () => {
        fetchVouchers.mockResolvedValue({ vouchers: [voucher], realmPath: "gno.land/r/samcrew/memba_arcade_leaderboard_v1", signerPubkeyHex: KEY })
        const { container } = renderPanel()
        await waitFor(() => expect(fetchSigner).toHaveBeenCalled())
        expect(container).toBeEmptyDOMElement()
        expect(screen.queryByRole("button")).toBeNull()
    })

    it("shows a recorded quest as done instead of offering it again", async () => {
        fetchRecorded.mockResolvedValue(new Set(["connect-wallet"]))
        renderPanel()
        expect(await screen.findByText("✓ on-chain")).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Attest on-chain" })).toBeNull()
    })
})
