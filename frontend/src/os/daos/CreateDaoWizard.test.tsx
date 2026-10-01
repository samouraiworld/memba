import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

const PRICE = { gas: 1000, ugnot: 3 }
const bank = vi.hoisted(() => ({ coins: "100000000ugnot", outcome: { outcome: "live" } as unknown, tx: false as boolean | "failed" }))

vi.mock("../../lib/dao/namespace", async (orig) => ({
    ...(await orig<typeof import("../../lib/dao/namespace")>()),
    assertCanDeployTo: vi.fn(async () => {}),
}))
vi.mock("../../lib/dao/packageStatus", async (orig) => ({
    ...(await orig<typeof import("../../lib/dao/packageStatus")>()),
    assertPathAvailable: vi.fn(async () => ({ replacesParked: false })),
    codeSubmissionPolicy: vi.fn(async () => "inert"),
    waitForPackage: vi.fn(async () => bank.outcome),
    abciQueryText: vi.fn(async (_ctx: unknown, path: string) => {
        if (path.startsWith("bank/balances/")) return JSON.stringify(bank.coins)
        throw new Error(`unexpected query ${path}`)
    }),
}))
vi.mock("../../lib/grc20", async (orig) => ({
    ...(await orig<typeof import("../../lib/grc20")>()),
    networkGasPrice: vi.fn(async () => PRICE),
    networkGasPriceFresh: vi.fn(async () => PRICE),
    doContractBroadcast: vi.fn(async () => ({ hash: "TXHASH" })),
}))
vi.mock("../../lib/config", async (orig) => ({ ...(await orig<typeof import("../../lib/config")>()), GNO_CHAIN_ID: "gnoland-1" }))
vi.mock("../wallet/sendRequest", () => ({ verifySendTx: async () => bank.tx }))
const sign = vi.hoisted(() => vi.fn(() => true))
vi.mock("../sign/signerContext", () => ({ useSigner: () => ({ sign }) }))
vi.mock("./createDao", async (orig) => ({
    ...(await orig<typeof import("./createDao")>()),
    userDaoCapabilities: () => ({ create: true, label: "gno.land" }),
}))

import { doContractBroadcast, FALLBACK_GAS_PRICE, feeForGasWanted, networkGasPrice } from "../../lib/grc20"
import { formatGnot } from "../../lib/templates/dao/v2/deposit"
import type { OsSession } from "../shell/useOsSession"
import type { SignRequest } from "../sign/signer"
import { CreateDaoWizard } from "./CreateDaoWizard"
import { emptyDaoDraft, saveDaoDraft } from "./createDao"

const ME = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const session = { status: "member", address: ME, openConnect: vi.fn() } as unknown as OsSession

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); Object.assign(bank, { coins: "100000000ugnot", outcome: { outcome: "live" }, tx: false }) })

async function deployed() {
    saveDaoDraft("gnoland-1", ME, { ...emptyDaoDraft(ME), name: "Gno Builders" })
    render(<CreateDaoWizard session={session} open={vi.fn()} close={vi.fn()} />)
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    await screen.findByTestId("os-dao-checks")
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: "Deploy with Adena…" }))
    const req = (sign.mock.calls[0] as unknown as [SignRequest<string>])[0]
    await act(async () => { await req.send(undefined, async () => () => true) })
    let verified: boolean | "failed" = false
    await act(async () => { verified = await req.verify!(undefined, "TXHASH", undefined) })
    return { req, verified }
}

describe("CreateDaoWizard — the result screen says what the tray says", () => {
    it("before the chain answers, says nothing about approval or the deposit", async () => {
        saveDaoDraft("gnoland-1", ME, { ...emptyDaoDraft(ME), name: "Gno Builders" })
        render(<CreateDaoWizard session={session} open={vi.fn()} close={vi.fn()} />)
        for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: "Continue" }))
        await screen.findByTestId("os-dao-checks")
        fireEvent.click(screen.getByRole("checkbox"))
        fireEvent.click(screen.getByRole("button", { name: "Deploy with Adena…" }))
        const req = (sign.mock.calls[0] as unknown as [SignRequest<string>])[0]
        await act(async () => { await req.send(undefined, async () => () => true) })
        expect(screen.getByRole("heading", { name: "Submitted · checking the network" })).toBeInTheDocument()
        expect(screen.queryByText(/Waiting for network approval/)).toBeNull()
        expect(screen.queryByText(/leaves your balance/)).toBeNull()
    })

    it("a parked deploy: submitted, waiting for approval, with when the deposit leaves", async () => {
        bank.outcome = { outcome: "pending", meta: null, unconfirmed: false }
        const { req, verified } = await deployed()
        expect(verified).toBe(false)
        expect(screen.getByRole("heading", { name: "Submitted · waiting for network approval" })).toBeInTheDocument()
        expect(screen.getByText(/^Waiting for network approval: .* The storage deposit \(about [0-9.]+ GNOT\) leaves your balance when gno\.land enables the package: keep it in this wallet until then\.$/)).toBeInTheDocument()
        expect(req.pendingNote!()).toMatch(/^Waiting for network approval/)
    })

    it("a deploy the chain refused: refused, with the fee charged", async () => {
        bank.outcome = { outcome: "failed", meta: null, error: "The network has no package at this path" }
        bank.tx = "failed"
        const { verified } = await deployed()
        expect(verified).toBe("failed")
        expect(screen.getByRole("heading", { name: "Refused by the network" })).toBeInTheDocument()
        expect(screen.getByText(/Nothing was deployed; the network fee was still charged/)).toBeInTheDocument()
    })

    it("no package and no refusal shown: not on chain yet, check before deploying again", async () => {
        bank.outcome = { outcome: "failed", meta: null, error: "The network has no package at this path" }
        const { req } = await deployed()
        expect(screen.getByRole("heading", { name: "Submitted · not on chain yet" })).toBeInTheDocument()
        expect(screen.getByText(req.pendingNote!()!)).toBeInTheDocument()
    })
})

describe("CreateDaoWizard — the fee the member reads is the fee the wallet is asked for", () => {
    it("shows one network fee in the wizard and in the signing sheet, and hands exactly that to the wallet", async () => {
        saveDaoDraft("gnoland-1", ME, { ...emptyDaoDraft(ME), name: "Gno Builders" })
        render(<CreateDaoWizard session={session} open={vi.fn()} close={vi.fn()} />)
        for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: "Continue" }))
        await screen.findByTestId("os-dao-checks")
        const shown = within(screen.getByText("Network fee").closest(".os-kv-row") as HTMLElement).getByRole("definition").textContent
        fireEvent.click(screen.getByRole("checkbox"))
        fireEvent.click(screen.getByRole("button", { name: "Deploy with Adena…" }))

        expect(sign).toHaveBeenCalledTimes(1)
        const req = (sign.mock.calls[0] as unknown as [SignRequest<string>])[0]
        expect(new Map(req.lines(undefined)).get("Network fee")).toBe(shown)
        await req.send(undefined, async () => () => true)
        const opts = vi.mocked(doContractBroadcast).mock.calls[0][2] as { gasWanted: number; gasFee: number }
        expect(formatGnot(opts.gasFee)).toBe(shown)
        // Priced at the network's price, not at the fallback the wizard starts with.
        expect(opts.gasFee).toBe(feeForGasWanted(opts.gasWanted, PRICE))
        expect(opts.gasFee).not.toBe(feeForGasWanted(opts.gasWanted, FALLBACK_GAS_PRICE))
    })

    it("labels a fee computed without a price read as an estimate, in the wizard and in the signing sheet", async () => {
        // What networkGasPrice gives back when no endpoint answers.
        vi.mocked(networkGasPrice).mockResolvedValueOnce(FALLBACK_GAS_PRICE)
        saveDaoDraft("gnoland-1", ME, { ...emptyDaoDraft(ME), name: "Gno Builders" })
        render(<CreateDaoWizard session={session} open={vi.fn()} close={vi.fn()} />)
        for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: "Continue" }))
        await screen.findByTestId("os-dao-checks")
        const shown = within(screen.getByText("Network fee").closest(".os-kv-row") as HTMLElement).getByRole("definition").textContent
        expect(shown).toMatch(/^about [0-9.]+ GNOT \(estimate: the network price could not be read; it is read again before signing\)$/)
        fireEvent.click(screen.getByRole("checkbox"))
        fireEvent.click(screen.getByRole("button", { name: "Deploy with Adena…" }))
        const req = (sign.mock.calls[0] as unknown as [SignRequest<string>])[0]
        expect(new Map(req.lines(undefined)).get("Network fee")).toBe(shown)
    })

    it("keeps Deploy disabled while the balance can't hold the fee and the deposit, and says when the deposit leaves", async () => {
        bank.coins = "1000000ugnot"
        saveDaoDraft("gnoland-1", ME, { ...emptyDaoDraft(ME), name: "Gno Builders" })
        render(<CreateDaoWizard session={session} open={vi.fn()} close={vi.fn()} />)
        for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: "Continue" }))
        expect(await screen.findByText(/Your balance is 1 GNOT\. Deploying can take up to .* \(at most [0-9.]+ GNOT\), taken when gno\.land enables the package\. Add GNOT to this wallet first\./)).toBeInTheDocument()
        expect(within(screen.getByText("Storage deposit").closest(".os-kv-row") as HTMLElement).getByRole("definition").textContent).toMatch(/, taken from your balance when gno\.land enables the package$/)
        expect(screen.getByRole("button", { name: "Deploy with Adena…" })).toBeDisabled()
        bank.coins = "100000000ugnot"
        fireEvent.click(screen.getByRole("button", { name: "Check again" }))
        await waitFor(() => expect(screen.getByRole("button", { name: "Deploy with Adena…" })).toBeEnabled())
        expect(screen.queryByText(/Add GNOT to this wallet first/)).toBeNull()
    })

    it("keeps Deploy disabled, with no figure shown, until the network price has been read", async () => {
        let priced!: (price: typeof PRICE) => void
        vi.mocked(networkGasPrice).mockImplementationOnce(() => new Promise((resolve) => { priced = resolve }))
        saveDaoDraft("gnoland-1", ME, { ...emptyDaoDraft(ME), name: "Gno Builders" })
        render(<CreateDaoWizard session={session} open={vi.fn()} close={vi.fn()} />)
        for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: "Continue" }))
        await screen.findByTestId("os-dao-checks")
        const fee = () => within(screen.getByText("Network fee").closest(".os-kv-row") as HTMLElement).getByRole("definition").textContent
        expect(fee()).toBe("reading the network price…")
        expect(screen.getByRole("button", { name: "Deploy with Adena…" })).toBeDisabled()
        await act(async () => { priced(PRICE) })
        expect(fee()).toMatch(/GNOT$/)
        expect(screen.getByRole("button", { name: "Deploy with Adena…" })).toBeEnabled()
    })
})
