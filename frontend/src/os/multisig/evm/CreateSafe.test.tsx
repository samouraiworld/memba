import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { getAddress } from "viem"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { OsSession } from "../../shell/useOsSession"
import { SafeCreateError } from "../../../lib/chain/evm/safe/create"
import { CreateSafe } from "./CreateSafe"
import { createErrorText } from "./describe"

vi.mock("../../../lib/chain/flag", () => ({ EVM_ENABLED: true }))

const ME = "0xa11ce00000000000000000000000000000000001"
const BOB = "0xb0b0000000000000000000000000000000000002"
const PREDICTED = "0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe"
const HASH = `0x${"ab".repeat(32)}`

const plan = { predicted: PREDICTED, owners: [ME, BOB], threshold: 2, saltNonce: 7n, tx: { to: "0x14F2982D601c9458F93bd70B218933A6f8165e7b", data: "0x", value: 0n } }
const sdk = {
    toChecksum: (a: string) => getAddress(a),
    planNewSafe: vi.fn(),
    deployNewSafe: vi.fn(),
    SafeCreateError,
}
vi.mock("../../../lib/chain/evm/safe/load", () => ({ loadSafeSdk: async () => sdk }))

const base = { network: { key: "base-sepolia", family: "evm", label: "Base Sepolia", chainId: "84532" }, layout: {}, openConnect: vi.fn() }
const connected = { ...base, status: "guest", address: "", walletAddress: ME } as unknown as OsSession
const guest = { ...base, status: "guest", address: "", walletAddress: "" } as unknown as OsSession

beforeEach(() => {
    vi.clearAllMocks()
    sdk.planNewSafe.mockResolvedValue(plan)
    sdk.deployNewSafe.mockImplementation(async (_key: string, _plan: unknown, onSent?: (h: string) => void) => { onSent?.(HASH); return { hash: HASH, safe: {} } })
})

function fillBob() {
    fireEvent.click(screen.getByRole("button", { name: "Add an owner" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Owner 2 address" }), { target: { value: getAddress(BOB) } })
    fireEvent.change(screen.getByRole("combobox", { name: "Signatures needed" }), { target: { value: "2" } })
}

describe("creating a Safe", () => {
    it("shows a guest the whole form and asks for a wallet only to review", () => {
        render(<CreateSafe session={guest} open={vi.fn()} />)
        expect(screen.getByRole("textbox", { name: "Owner 1 address" })).toHaveValue("")
        fireEvent.click(screen.getByRole("button", { name: "Connect a wallet to review" }))
        expect(guest.openConnect).toHaveBeenCalledOnce()
        expect(sdk.planNewSafe).not.toHaveBeenCalled()
    })

    it("starts from the connected wallet, refuses a duplicate or a bad checksum before building anything", async () => {
        render(<CreateSafe session={connected} open={vi.fn()} />)
        expect(screen.getByRole("textbox", { name: "Owner 1 address" })).toHaveValue(ME)
        fireEvent.click(screen.getByRole("button", { name: "Add an owner" }))
        fireEvent.change(screen.getByRole("textbox", { name: "Owner 2 address" }), { target: { value: ME.toUpperCase().replace("0X", "0x") } })
        fireEvent.click(screen.getByRole("button", { name: "Review" }))
        expect(await screen.findByRole("alert")).toHaveTextContent("Owner 2 is listed twice.")
        const bob = getAddress(BOB)
        const i = bob.slice(2).search(/[a-fA-F]/) + 2
        const broken = `${bob.slice(0, i)}${bob[i] === bob[i].toLowerCase() ? bob[i].toUpperCase() : bob[i].toLowerCase()}${bob.slice(i + 1)}`
        fireEvent.change(screen.getByRole("textbox", { name: "Owner 2 address" }), { target: { value: broken } })
        fireEvent.click(screen.getByRole("button", { name: "Review" }))
        expect(await screen.findByRole("alert")).toHaveTextContent(/Owner 2: .*checksum/)
        expect(sdk.planNewSafe).not.toHaveBeenCalled()
    })

    it("reviews the predicted address and owners in full, then creates and offers to open the Safe", async () => {
        const open = vi.fn()
        render(<CreateSafe session={connected} open={open} />)
        fillBob()
        fireEvent.click(screen.getByRole("button", { name: "Review" }))
        expect(await screen.findByText("Review the new Safe")).toBeInTheDocument()
        expect(sdk.planNewSafe).toHaveBeenCalledWith("base-sepolia", [ME, BOB], 2)
        expect(screen.getByLabelText(getAddress(PREDICTED))).toHaveTextContent(addressInGroups(PREDICTED))
        expect(screen.getByText("2 of 2")).toBeInTheDocument()
        expect(screen.getByText("Safe v1.5.0 (L2), no modules")).toBeInTheDocument()

        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create Safe" })) })
        expect(await screen.findByText("Safe created")).toBeInTheDocument()
        expect(screen.getByRole("link", { name: "Transaction" })).toHaveAttribute("href", `https://sepolia.basescan.org/tx/${HASH}`)
        fireEvent.click(screen.getByRole("button", { name: "Open Safe" }))
        expect(open.mock.calls[0][0].target).toEqual({ kind: "multisig", address: PREDICTED })
    })

    it("keeps the review when the wallet declines, and says nothing was sent", async () => {
        sdk.deployNewSafe.mockRejectedValue(new SafeCreateError({ code: "declined" }))
        render(<CreateSafe session={connected} open={vi.fn()} />)
        fillBob()
        fireEvent.click(screen.getByRole("button", { name: "Review" }))
        await screen.findByText("Review the new Safe")
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create Safe" })) })
        expect(await screen.findByRole("alert")).toHaveTextContent("You declined in your wallet. Nothing was sent.")
        expect(screen.getByRole("button", { name: "Create Safe" })).toBeEnabled()
    })

    it("goes back to the form when the deployment can't be built as asked, with the reason", async () => {
        sdk.planNewSafe.mockRejectedValue(new SafeCreateError({ code: "wrong-chain" }))
        render(<CreateSafe session={connected} open={vi.fn()} />)
        fireEvent.click(screen.getByRole("button", { name: "Review" }))
        await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Switch it to Base Sepolia"))
        expect(screen.getByRole("button", { name: "Review" })).toBeInTheDocument()
    })

    it("names every way creation can stop", () => {
        for (const code of ["not-connected", "wrong-chain", "declined", "address-taken", "reverted"] as const) expect(createErrorText({ code } as never, "Base Sepolia")).toBeTruthy()
        expect(createErrorText({ code: "unexpected-deployment", detail: "another threshold" }, "Base Sepolia")).toMatch(/another threshold.*Nothing was sent/)
        expect(createErrorText({ code: "not-the-safe", hash: "0x" }, "Base Sepolia")).toMatch(/Don't send funds/)
    })
})

function addressInGroups(a: string): string {
    const d = getAddress(a)
    return `0x ${d.slice(2).match(/.{4}/g)!.join(" ")}`
}
