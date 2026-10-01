import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const chain = vi.hoisted(() => ({
    policy: "inert",
    replacesParked: false,
    outcome: { outcome: "live" } as { outcome: string; meta?: unknown; unconfirmed?: boolean; error?: string },
    wallet: vi.fn(async (): Promise<{ hash: string }> => ({ hash: "TXHASH" })),
    price: vi.fn(async () => ({ gas: 1000, ugnot: 1 })),
    pendingAtWallet: null as unknown,
    tx: vi.fn(async (): Promise<boolean | "failed"> => false),
    coins: "100000000ugnot",
}))

vi.mock("../../lib/dao/namespace", async (orig) => ({
    ...(await orig<typeof import("../../lib/dao/namespace")>()),
    assertCanDeployTo: vi.fn(async () => {}),
}))
vi.mock("../../lib/dao/packageStatus", async (orig) => ({
    ...(await orig<typeof import("../../lib/dao/packageStatus")>()),
    assertPathAvailable: vi.fn(async () => ({ replacesParked: chain.replacesParked })),
    codeSubmissionPolicy: vi.fn(async () => chain.policy),
    waitForPackage: vi.fn(async () => chain.outcome),
    abciQueryText: vi.fn(async (_ctx: unknown, path: string) => {
        if (path.startsWith("bank/balances/")) return JSON.stringify(chain.coins)
        throw new Error(`unexpected query ${path}`)
    }),
}))
vi.mock("../../lib/grc20", async (orig) => ({
    ...(await orig<typeof import("../../lib/grc20")>()),
    networkGasPriceFresh: () => chain.price(),
    // Stand-in for the broadcaster: beforeSign, then the wallet.
    doContractBroadcast: vi.fn(async (_msgs: unknown, _memo: string, opts: { beforeSign?: () => Promise<void | (() => boolean)> }) => {
        const { setTxConfirmationCallback } = await import("../../lib/grc20")
        const confirm = setTxConfirmationCallback(null)
        setTxConfirmationCallback(confirm)
        if (confirm && !(await confirm(_msgs as import("../../lib/grc20").AminoMsg[], _memo))) throw new Error("Transaction cancelled by user")
        const guard = await opts.beforeSign?.()
        if (guard && !guard()) throw new Error("Session changed")
        const { listPendingDAOs } = await import("../../lib/dao/packageStatus")
        chain.pendingAtWallet = listPendingDAOs("gnoland-1")[0] ?? null
        return chain.wallet()
    }),
}))
vi.mock("../wallet/sendRequest", () => ({ verifySendTx: () => chain.tx() }))
vi.mock("../../lib/config", async (orig) => ({ ...(await orig<typeof import("../../lib/config")>()), GNO_CHAIN_ID: "gnoland-1" }))

import { clearPendingMemory, listPendingDAOs } from "../../lib/dao/packageStatus"
import { getAllSavedDAOs } from "../../lib/daoSlug"
import { ChainRejectedError, doContractBroadcast, FALLBACK_GAS_PRICE } from "../../lib/grc20"
import { executeSignature } from "../sign/signer"
import { daoConfig, emptyDaoDraft } from "./createDao"
import { balanceShortfall, createDaoRequest, deployCosts, MISSING_NOTE, PARKED_NOTE, runDeployChecks, type CreateDaoContext } from "./createDaoRequest"

const ME = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const config = daoConfig({ ...emptyDaoDraft(ME), name: "Gno Builders" }, ME)
const PATH = `gno.land/r/${ME}/gno_builders`

function ctx(over: Partial<CreateDaoContext> = {}): CreateDaoContext {
    return {
        wallet: ME, config, checks: { policy: "inert", replacesParked: false, balanceUgnot: 100_000_000n }, price: FALLBACK_GAS_PRICE, lines: [], warns: [],
        onRisenPrice: vi.fn(), onSubmitted: vi.fn(), onResult: vi.fn(), ...over,
    }
}

beforeEach(() => {
    chain.policy = "inert"
    chain.replacesParked = false
    chain.outcome = { outcome: "live" }
    chain.wallet.mockImplementation(async () => ({ hash: "TXHASH" }))
    chain.price.mockResolvedValue({ gas: 1000, ugnot: 1 })
    chain.pendingAtWallet = null
    chain.tx.mockResolvedValue(false)
    chain.coins = "100000000ugnot"
})
afterEach(() => { localStorage.clear(); clearPendingMemory(); vi.clearAllMocks() })

describe("createDaoRequest", () => {
    it("deploys the generated package with the deposit cap and the policy's gas budget", async () => {
        const req = createDaoRequest(ctx())
        const [msg] = req.prepare(undefined).msgs
        expect(msg.type).toBe("/vm.m_addpkg")
        expect(msg.value).toMatchObject({ creator: ME, package: { path: PATH }, max_deposit: expect.stringMatching(/^[0-9]+ugnot$/) })
        await req.send(undefined, async () => {})
        expect(vi.mocked(doContractBroadcast).mock.calls[0][2]).toMatchObject({ gas: "deploy", gasWanted: expect.any(Number) })
    })

    it("saves the pending intent before the wallet opens, and the hash after", async () => {
        const c = ctx()
        await createDaoRequest(c).send(undefined, async () => {})
        expect(chain.pendingAtWallet).toMatchObject({ path: PATH, phase: "intent", wallet: ME, txHash: "" })
        expect(listPendingDAOs("gnoland-1")[0]).toMatchObject({ path: PATH, phase: "submitted", txHash: "TXHASH" })
        expect(c.onSubmitted).toHaveBeenCalledWith("TXHASH")
    })

    it("drops the intent when nothing was sent, through the signer", async () => {
        const req = createDaoRequest(ctx())
        chain.policy = "permissionless" // the recheck sees a changed network
        const res = await executeSignature(req, undefined, req.prepare(undefined).msgs, () => {})
        expect(res).toMatchObject({ outcome: "failed", error: expect.stringContaining("rules for this address changed") })
        expect(chain.wallet).not.toHaveBeenCalled()
        expect(listPendingDAOs("gnoland-1")).toEqual([])
    })

    it("hands the wallet exactly the fee the review showed, after reading the price again", async () => {
        const price = { gas: 1000, ugnot: 2 }
        chain.price.mockResolvedValue(price)
        const shown = deployCosts(config, "inert", price)
        const c = ctx({ price })
        const req = createDaoRequest(c)
        const res = await executeSignature(req, undefined, req.prepare(undefined).msgs, () => {})
        expect(res.outcome).toBe("sent")
        expect(vi.mocked(doContractBroadcast).mock.calls[0][2]).toMatchObject({ gasWanted: shown.gasWanted, gasFee: shown.feeUgnot })
        expect(chain.price).toHaveBeenCalledTimes(1)
        expect(c.onRisenPrice).not.toHaveBeenCalled()
    })

    it("stops before the wallet when the network fee rose since the review, and reports the new price to the review", async () => {
        const risenPrice = { gas: 1000, ugnot: 8 }
        chain.price.mockResolvedValue(risenPrice)
        const c = ctx()
        const risen = createDaoRequest(c)
        expect(await executeSignature(risen, undefined, risen.prepare(undefined).msgs, () => {}))
            .toMatchObject({ outcome: "failed", error: expect.stringContaining("network fee increased since review") })
        expect(c.onRisenPrice).toHaveBeenCalledWith(risenPrice)
        chain.price.mockRejectedValue(new Error("offline"))
        const unreadable = createDaoRequest(ctx())
        expect(await executeSignature(unreadable, undefined, unreadable.prepare(undefined).msgs, () => {}))
            .toMatchObject({ outcome: "failed", error: expect.stringContaining("Couldn't confirm the current network fee") })
        expect(chain.wallet).not.toHaveBeenCalled()
        expect(listPendingDAOs("gnoland-1")).toEqual([])
    })

    it("accepts a fee that went down: the wallet still gets the reviewed fee, and the review keeps its figure", async () => {
        const price = { gas: 1000, ugnot: 2 }
        const c = ctx({ price })
        const req = createDaoRequest(c)
        expect((await executeSignature(req, undefined, req.prepare(undefined).msgs, () => {})).outcome).toBe("sent")
        expect(vi.mocked(doContractBroadcast).mock.calls[0][2]).toMatchObject({ gasFee: deployCosts(config, "inert", price).feeUgnot })
        expect(c.onRisenPrice).not.toHaveBeenCalled()
    })

    it("drops the intent when the network refuses the deploy, and says why", async () => {
        chain.wallet.mockImplementation(async () => { throw new ChainRejectedError("Error: out of gas error", "Data: std.OutOfGasError{}\nMsg Traces:\n    0  out of gas in location: WritePerByte", "H") })
        const req = createDaoRequest(ctx())
        const res = await executeSignature(req, undefined, req.prepare(undefined).msgs, () => {})
        expect(res).toMatchObject({ outcome: "refused", error: expect.stringContaining("out of gas in location: WritePerByte") })
        expect(listPendingDAOs("gnoland-1")).toEqual([])
    })

    it("keeps the intent when the wallet outcome is unknown", async () => {
        chain.wallet.mockImplementation(async () => { throw new Error("network timeout") })
        const req = createDaoRequest(ctx())
        const res = await executeSignature(req, undefined, req.prepare(undefined).msgs, () => {})
        expect(res.outcome).toBe("unknown")
        expect(listPendingDAOs("gnoland-1")[0]).toMatchObject({ path: PATH, phase: "intent" })
    })

    it("a live package is saved to the DAO list and its pending record cleared", async () => {
        const c = ctx()
        const req = createDaoRequest(c)
        await req.send(undefined, async () => {})
        await expect(req.verify!(undefined, "TXHASH", undefined)).resolves.toBe(true)
        expect(getAllSavedDAOs().some((d) => d.realmPath === PATH)).toBe(true)
        expect(listPendingDAOs("gnoland-1")).toEqual([])
        expect(c.onResult).toHaveBeenCalledWith({ kind: "live" }, "TXHASH")
        expect(req.verifyAttempts).toBe(1)
    })

    it("a parked package waits for network approval and stays recorded", async () => {
        chain.outcome = { outcome: "pending", meta: { path: PATH, status: "inert", reason: "awaiting approval" }, unconfirmed: false }
        const c = ctx()
        const req = createDaoRequest(c)
        await req.send(undefined, async () => {})
        await expect(req.verify!(undefined, "TXHASH", undefined)).resolves.toBe(false)
        expect(c.onResult).toHaveBeenCalledWith({ kind: "pending", unconfirmed: false, reason: "awaiting approval" }, "TXHASH")
        expect(listPendingDAOs("gnoland-1")[0]).toMatchObject({ phase: "submitted", txHash: "TXHASH", reason: "awaiting approval" })
        // The tray says what the wizard says: submitted, waiting for approval.
        expect(req.pendingNote!()).toBe(PARKED_NOTE)
    })

    it("a status that could not be read leaves the tray's own words", async () => {
        chain.outcome = { outcome: "pending", meta: null, unconfirmed: true }
        const req = createDaoRequest(ctx())
        await req.send(undefined, async () => {})
        await expect(req.verify!(undefined, "TXHASH", undefined)).resolves.toBe(false)
        expect(req.pendingNote!()).toBeUndefined()
    })

    it("a deploy the chain ran and refused is final: failed in the tray, its pending record dropped", async () => {
        chain.outcome = { outcome: "failed", error: "The network has no package at this path" }
        chain.tx.mockResolvedValue("failed")
        const c = ctx()
        const req = createDaoRequest(c)
        await req.send(undefined, async () => {})
        await expect(req.verify!(undefined, "TXHASH", undefined)).resolves.toBe("failed")
        expect(c.onResult).toHaveBeenCalledWith({ kind: "refused" }, "TXHASH")
        expect(listPendingDAOs("gnoland-1")).toEqual([])
    })

    it.each([["not shown", async () => false as const], ["delivered, not refused", async () => true as const], ["unreadable", async () => { throw new Error("no node") }]])(
        "a missing package whose transaction is %s stays unconfirmed and recorded",
        async (_what, tx: () => Promise<boolean | "failed">) => {
            chain.outcome = { outcome: "failed", error: "The network has no package at this path" }
            chain.tx.mockImplementation(tx)
            const c = ctx()
            const req = createDaoRequest(c)
            await req.send(undefined, async () => {})
            await expect(req.verify!(undefined, "TXHASH", undefined)).resolves.toBe(false)
            expect(c.onResult).toHaveBeenCalledWith({ kind: "missing" }, "TXHASH")
            expect(listPendingDAOs("gnoland-1")[0]).toMatchObject({ phase: "submitted", txHash: "TXHASH" })
            expect(req.pendingNote!()).toBe(MISSING_NOTE)
        })

    it("refuses to build a deploy with the zero address as a member", async () => {
        const { GUEST_SEAT, ZERO_MEMBER } = await import("./createDao")
        expect(() => createDaoRequest(ctx({ config: { ...config, members: [...config.members, { address: GUEST_SEAT, power: 1, roles: ["member"] }] } }))).toThrow(ZERO_MEMBER)
    })

    it("reads the address checks and the network price at the same time", async () => {
        const { assertCanDeployTo } = await import("../../lib/dao/namespace")
        let namespaceRead!: () => void
        vi.mocked(assertCanDeployTo).mockImplementationOnce(() => new Promise<void>((resolve) => { namespaceRead = resolve }))
        chain.price.mockClear()
        const checking = createDaoRequest(ctx()).recheck!(undefined)
        await vi.waitFor(() => expect(namespaceRead).toBeTypeOf("function"))
        // The namespace hasn't answered, and the price is already asked.
        expect(chain.price).toHaveBeenCalled()
        namespaceRead()
        await expect(checking).resolves.toBeUndefined()
    })

    it("stops before the wallet when the balance no longer holds the fee and the deposit", async () => {
        const c = ctx()
        const req = createDaoRequest(c)
        const { feeUgnot, capUgnot } = deployCosts(config, "inert", FALLBACK_GAS_PRICE)
        chain.coins = `${feeUgnot + capUgnot - 1}ugnot`
        await expect(req.recheck!(undefined)).rejects.toThrow(/Add GNOT to this wallet first\. Nothing was sent\./)
        chain.coins = `${feeUgnot + capUgnot}ugnot`
        await expect(req.recheck!(undefined)).resolves.toBeUndefined()
    })

    it.each([["an unanswered balance read", () => { throw new Error("no node") }], ["a malformed balance", () => '"lots"']])(
        "stops before the wallet on %s, never assuming funds", async (_what, answer) => {
            const { abciQueryText } = await import("../../lib/dao/packageStatus")
            vi.mocked(abciQueryText).mockImplementationOnce(async () => answer())
            await expect(createDaoRequest(ctx()).recheck!(undefined)).rejects.toThrow()
            expect(chain.wallet).not.toHaveBeenCalled()
        })

    it("a policy unreadable at review that reads permissionless now still needs the balance", async () => {
        chain.policy = "permissionless"
        chain.coins = "1000000ugnot"
        await expect(createDaoRequest(ctx({ checks: { policy: "unknown", replacesParked: false, balanceUgnot: 100_000_000n } })).recheck!(undefined))
            .rejects.toThrow(/taken when the package is deployed\. Add GNOT to this wallet first\. Nothing was sent\./)
    })

    it("a policy unreadable at review is no change of rules; one unreadable now stops with its own words", async () => {
        chain.policy = "inert"
        await expect(createDaoRequest(ctx({ checks: { policy: "unknown", replacesParked: false, balanceUgnot: 100_000_000n } })).recheck!(undefined)).resolves.toBeUndefined()
        const { codeSubmissionPolicy } = await import("../../lib/dao/packageStatus")
        vi.mocked(codeSubmissionPolicy).mockRejectedValueOnce(new Error("no node"))
        await expect(createDaoRequest(ctx()).recheck!(undefined)).rejects.toThrow(/couldn't read the network's rules/)
        chain.policy = "permissionless"
        await expect(createDaoRequest(ctx()).recheck!(undefined)).rejects.toThrow(/rules for this address changed/)
    })

    it("refuses a second deploy to the same address while one waits for Adena", async () => {
        let release!: (v: { hash: string }) => void
        chain.wallet.mockImplementation(() => new Promise((r) => { release = r }))
        const first = createDaoRequest(ctx()).send(undefined, async () => {})
        await vi.waitFor(() => expect(release).toBeTypeOf("function"))
        const second = createDaoRequest(ctx())
        await expect(second.send(undefined, async () => {})).rejects.toThrow(/already waiting/)
        second.onNothingSent!() // must not drop the first attempt's record
        expect(listPendingDAOs("gnoland-1")).toHaveLength(1)
        release({ hash: "H" })
        await first
    })
})

describe("balanceShortfall", () => {
    // friends_surf_club on gnoland-1: max_deposit 17000000ugnot, 8,120,800 ugnot taken at enable (81,208 bytes).
    const costs = { feeUgnot: 60_000, estimateUgnot: 8_178_500, capUgnot: 17_000_000 }
    it("needs the fee and the deposit cap, not the estimate, and says when the deposit leaves", () => {
        expect(balanceShortfall(60_000n + 8_120_800n, costs, "inert")).toMatch(/can take up to 17\.1 GNOT.*deposit of about 8\.2 GNOT \(at most 17 GNOT\), taken when gno\.land enables the package/)
        expect(balanceShortfall(17_059_999n, costs, "inert")).not.toBeNull()
        expect(balanceShortfall(17_060_000n, costs, "inert")).toBeNull()
        expect(balanceShortfall(0n, costs, "permissionless")).toMatch(/taken when the package is deployed/)
    })
})

describe("runDeployChecks", () => {
    it("starts every read at once: namespace, address, policy and balance", async () => {
        const { assertCanDeployTo } = await import("../../lib/dao/namespace")
        const { abciQueryText, assertPathAvailable, codeSubmissionPolicy } = await import("../../lib/dao/packageStatus")
        let answer!: () => void
        vi.mocked(assertCanDeployTo).mockImplementationOnce(() => new Promise<void>((resolve) => { answer = resolve }))
        const checks = runDeployChecks(ME, PATH)
        await vi.waitFor(() => expect(answer).toBeTypeOf("function"))
        // The namespace hasn't answered, and the other reads are already out.
        expect(assertPathAvailable).toHaveBeenCalled()
        expect(codeSubmissionPolicy).toHaveBeenCalled()
        expect(abciQueryText).toHaveBeenCalledWith(expect.anything(), `bank/balances/${ME}`, "")
        answer()
        await expect(checks).resolves.toMatchObject({ policy: "inert" })
    })

    it("names what to change when the address is taken: the DAO name", async () => {
        const { assertPathAvailable, PathTakenError } = await import("../../lib/dao/packageStatus")
        vi.mocked(assertPathAvailable).mockRejectedValueOnce(new PathTakenError("taken"))
        await expect(runDeployChecks(ME, PATH)).rejects.toThrow("Change the DAO name in step 1: the address is made from the name's Latin letters a–z and digits, up to 20.")
    })

    it("reports the policy and whether a parked submission is replaced", async () => {
        chain.replacesParked = true
        await expect(runDeployChecks(ME, PATH)).resolves.toEqual({ policy: "inert", replacesParked: true, balanceUgnot: 100_000_000n })
    })
})
