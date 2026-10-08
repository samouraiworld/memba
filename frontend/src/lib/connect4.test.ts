import { beforeEach, describe, expect, it, vi } from "vitest"

const qeval = vi.hoisted(() => vi.fn())
const broadcast = vi.hoisted(() => vi.fn(async () => ({ hash: "h" })))
vi.mock("./dao/shared", async (orig) => ({ ...(await orig<typeof import("./dao/shared")>()), queryEval: qeval }))
vi.mock("./grc20", () => ({ doContractBroadcast: broadcast }))
const qp = vi.hoisted(() => ({ quickPlayOn: vi.fn(), quickPlayCall: vi.fn(), withQuickPlay: vi.fn((_m: string, _s: number, b?: unknown) => b) }))
vi.mock("./quickPlay", async (orig) => ({ ...(await orig<typeof import("./quickPlay")>()), ...qp }))
vi.mock("./config", async (orig) => ({
    ...(await orig<typeof import("./config")>()),
    connect4PathFor: () => "gno.land/r/test/c4",
    GNO_RPC_URL: "https://rpc.test",
}))

import { QuickPlayUnavailable } from "./quickPlay"
import { accept, buildCall, cancel, getActive, getGame, isGame, getLeaders, offer, play, resign, revealSeed, revealKey, sha256Hex, type Game } from "./connect4"

export const sample: Game = {
    id: 3, creator: "g1creator", opponent: "", acceptor: "g1acceptor", stake: 2_000_000, fee: 100_000,
    expiresAt: 1_000, commitment: "a".repeat(64), seedCommitment: "b".repeat(64), revealed: true, board: "0".repeat(42), turn: 1, turnPlayer: "g1creator",
    moves: 0, lastCol: 0, lastRow: 0, deadline: 1_090, status: "playing", winner: "",
}
const wrap = (v: unknown) => `(${JSON.stringify(JSON.stringify(v))} string)`

beforeEach(() => { qeval.mockReset(); broadcast.mockClear(); qp.quickPlayOn.mockReset(); qp.quickPlayCall.mockReset() })

describe("isGame", () => {
    it("accepts a valid game", () => expect(isGame(sample)).toBe(true))
    it.each([
        ["short board", { ...sample, board: "0".repeat(41) }],
        ["bad board char", { ...sample, board: "3" + "0".repeat(41) }],
        ["turn 3", { ...sample, turn: 3 }],
        ["unknown status", { ...sample, status: "paused" }],
        ["string stake", { ...sample, stake: "2000000" }],
        ["missing winner", { ...sample, winner: undefined }],
        ["null", null],
    ])("rejects %s", (_, v) => expect(isGame(v)).toBe(false))
})

describe("getGame", () => {
    it("queries GameJSON with the integer id and returns the game", async () => {
        qeval.mockResolvedValue(wrap({ now: 1_050, game: sample }))
        await expect(getGame(3)).resolves.toEqual({ now: 1_050, game: sample })
        expect(qeval).toHaveBeenCalledWith("https://rpc.test", "gno.land/r/test/c4", "GameJSON(3)", false)
    })
    it("maps an unknown or malformed game to game: null", async () => {
        qeval.mockResolvedValue(wrap({ now: 1, game: null }))
        await expect(getGame(9)).resolves.toEqual({ now: 1, game: null })
        qeval.mockResolvedValue(wrap({ now: 1, game: { ...sample, turn: 7 } }))
        await expect(getGame(9)).resolves.toEqual({ now: 1, game: null })
    })
    it.each([-1, 1.5, Number.NaN, 2 ** 60])("never queries for id %s", async (id) => {
        await expect(getGame(id)).resolves.toBeNull()
        expect(qeval).not.toHaveBeenCalled()
    })
    it("returns null when the node fails", async () => {
        qeval.mockResolvedValue(null)
        await expect(getGame(3)).resolves.toBeNull()
    })
})

describe("getActive", () => {
    it("filters malformed entries and clamps paging", async () => {
        qeval.mockResolvedValue(wrap({ now: 5, fee: 100_000, games: [sample, { id: "x" }] }))
        await expect(getActive(0, 500)).resolves.toEqual({ now: 5, fee: 100_000, games: [sample] })
        expect(qeval).toHaveBeenCalledWith("https://rpc.test", "gno.land/r/test/c4", "ActiveJSON(0, 100)", false)
    })
    it("gives no fee when the realm's is missing or malformed, so no offer can name a maximum", async () => {
        for (const fee of [undefined, -1, 1.5, "100000"]) {
            qeval.mockResolvedValue(wrap({ now: 5, fee, games: [] }))
            await expect(getActive(0, 10)).resolves.toEqual({ now: 5, fee: null, games: [] })
        }
    })
    it("never queries with a non-integer offset", async () => {
        await expect(getActive(-1, 10)).resolves.toBeNull()
        expect(qeval).not.toHaveBeenCalled()
    })
})

describe("getLeaders", () => {
    const A = "g1cvr48r7l7lkmvp77cr6zg2zhu26jgfwr0y8pew"
    it("keeps well-formed rows, at most 10 per board", async () => {
        const many = Array.from({ length: 12 }, (_, i) => ({ addr: A, score: 12 - i }))
        qeval.mockResolvedValue(wrap({ wins: [{ addr: A, score: 3 }, { addr: "<script>", score: 2 }, { addr: A, score: -1 }, { addr: A, score: 1.5 }], gnot: many }))
        const r = await getLeaders()
        expect(qeval).toHaveBeenCalledWith("https://rpc.test", "gno.land/r/test/c4", "LeadersJSON()", false)
        expect(r?.wins).toEqual([{ addr: A, score: 3 }])
        expect(r?.gnot).toHaveLength(10)
    })
    it("is null on a malformed reply or a failed read", async () => {
        qeval.mockResolvedValue(wrap({ wins: "nope" }))
        await expect(getLeaders()).resolves.toBeNull()
        qeval.mockRejectedValue(new Error("down"))
        await expect(getLeaders()).resolves.toBeNull()
    })
})

describe("writes", () => {
    beforeEach(() => { broadcast.mockClear(); localStorage.clear() })

    it("attaches coins only to Offer and Accept", async () => {
        expect(buildCall("Play", ["3", "4"], "g1me").value.send).toBe("")
        expect(buildCall("Accept", ["3"], "g1me", 2_000_000).value.send).toBe("2000000ugnot")
        await accept("g1me", sample)
        expect(broadcast.mock.calls[0][0][0].value).toMatchObject({ func: "Accept", args: ["3", expect.stringMatching(/^[0-9a-f]{64}$/)], send: "2000000ugnot", pkg_path: "gno.land/r/test/c4", caller: "g1me" })
        await play("g1me", 3, 4, 0)
        expect(broadcast.mock.calls[1][0][0].value).toMatchObject({ func: "Play", args: ["3", "4", "0"], send: "" })
        expect(broadcast.mock.calls[1][2]).toEqual({ gasWanted: 20_000_000 })
    })

    it("sends Offer and Accept through withQuickPlay with their stake", async () => {
        const mine = vi.fn(async () => ({ hash: "h" }))
        await accept("g1me", sample, mine)
        expect(qp.withQuickPlay).toHaveBeenCalledWith("g1me", 2_000_000, mine, true)
        await offer("g1me", { stakeUgnot: 3_000_000, validFor: 10, opponent: "", maxFeeUgnot: 100_000 }, mine, false)
        expect(qp.withQuickPlay).toHaveBeenLastCalledWith("g1me", 3_000_000, mine, false)
        expect(mine).toHaveBeenCalledTimes(2)
    })

    it("rejects out-of-range columns before signing", async () => {
        await expect(play("g1me", 3, 0, 0)).rejects.toThrow()
        await expect(play("g1me", 3, 8, 0)).rejects.toThrow()
        expect(broadcast).not.toHaveBeenCalled()
    })

    it("offer commits to sha256 of a stored fresh passphrase", async () => {
        const commitment = await offer("g1me", { stakeUgnot: 2_000_000, validFor: 10, opponent: "", maxFeeUgnot: 100_000 })
        const pass = revealKey("g1me", commitment)!
        expect(pass).toMatch(/^[0-9a-f]{64}$/)
        expect(await sha256Hex(pass)).toBe(commitment)
        expect(broadcast.mock.calls[0][0][0].value).toMatchObject({ func: "Offer", args: ["", "10", commitment, "100000"], send: "2000000ugnot" })
        expect(broadcast.mock.calls[0][2]).toEqual({ gasWanted: 20_000_000 })
        const second = await offer("g1me", { stakeUgnot: 2_000_000, validFor: 10, opponent: "", maxFeeUgnot: 100_000 })
        expect(second).not.toBe(commitment)
        expect(revealKey("g1other", commitment)).toBeNull()
    })

    it("refuses an offer without a known maximum fee, before anything is stored or sent", async () => {
        for (const maxFeeUgnot of [Number.NaN, -1, 0.5]) {
            await expect(offer("g1me", { stakeUgnot: 2_000_000, validFor: 10, opponent: "", maxFeeUgnot })).rejects.toThrow(/nothing was sent/)
        }
        expect(broadcast).not.toHaveBeenCalled()
        expect(localStorage.getItem("memba.connect4.pass.g1me")).toBeNull()
    })

    it("refuses to sign an offer when the key cannot be stored", async () => {
        const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("quota") })
        await expect(offer("g1me", { stakeUgnot: 2_000_000, validFor: 10, opponent: "", maxFeeUgnot: 100_000 })).rejects.toThrow(/nothing was sent/)
        expect(broadcast).not.toHaveBeenCalled()
        spy.mockRestore()
    })

    it("refuses to overwrite a damaged key store", async () => {
        for (const bad of ["{oops", "[1]", "null", "7"]) {
            localStorage.setItem("memba.connect4.pass.g1me", bad)
            await expect(offer("g1me", { stakeUgnot: 2_000_000, validFor: 10, opponent: "", maxFeeUgnot: 100_000 })).rejects.toThrow(/look damaged/)
            expect(localStorage.getItem("memba.connect4.pass.g1me")).toBe(bad)
        }
        expect(broadcast).not.toHaveBeenCalled()
    })

    it("sha256Hex matches a known vector", async () => {
        expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    })
})

describe("acceptor seed", () => {
    beforeEach(() => { broadcast.mockClear(); localStorage.clear() })
    it("stores a fresh seed under its commitment before signing, and sends only the commitment", async () => {
        await accept("g1me", sample)
        const commitment = broadcast.mock.calls[0][0][0].value.args[1]
        const seed = revealKey("g1me", commitment)
        expect(seed).toMatch(/^[0-9a-f]{64}$/)
        expect(await sha256Hex(seed!)).toBe(commitment)
        await accept("g1me", sample)
        expect(broadcast.mock.calls[1][0][0].value.args[1]).not.toBe(commitment) // fresh per game
    })
})

describe("Quick play routing", () => {
    it("sends coin-free moves through Quick play when active, Adena otherwise", async () => {
        qp.quickPlayOn.mockReturnValue(true)
        qp.quickPlayCall.mockResolvedValue({ hash: "H" })
        await play("g1me", 3, 4, 0)
        expect(qp.quickPlayCall).toHaveBeenCalledWith("g1me", "Play", ["3", "4", "0"])
        expect(broadcast).not.toHaveBeenCalled()
        qp.quickPlayOn.mockReturnValue(false)
        await play("g1me", 3, 5, 0)
        expect(broadcast).toHaveBeenCalledTimes(1)
    })
    it("sends RevealSeed through Quick play like the other moves", async () => {
        qp.quickPlayOn.mockReturnValue(true)
        qp.quickPlayCall.mockResolvedValue({ hash: "H" })
        await revealSeed("g1me", 3, "s")
        expect(qp.quickPlayCall).toHaveBeenCalledWith("g1me", "RevealSeed", ["3", "s"])
    })
    it("never routes stakes, Cancel or Resign through Quick play", async () => {
        qp.quickPlayOn.mockReturnValue(true)
        await accept("g1me", sample)
        await cancel("g1me", 3)
        await resign("g1me", 3)
        expect(qp.quickPlayCall).not.toHaveBeenCalled()
    })
    it("falls back to Adena at once when the session is unavailable", async () => {
        qp.quickPlayOn.mockReturnValue(true)
        qp.quickPlayCall.mockRejectedValue(new QuickPlayUnavailable("ended", "x"))
        const seen: string[] = []
        const on = (e: Event) => seen.push((e as CustomEvent<string>).detail)
        window.addEventListener("memba:quickplay-fallback", on)
        await play("g1me", 3, 4, 0)
        window.removeEventListener("memba:quickplay-fallback", on)
        expect(broadcast).toHaveBeenCalledTimes(1)
        expect(seen).toEqual(["x"])
    })
    it("propagates other errors", async () => {
        qp.quickPlayOn.mockReturnValue(true)
        qp.quickPlayCall.mockRejectedValue(new Error("not your turn"))
        await expect(play("g1me", 3, 4, 0)).rejects.toThrow("not your turn")
        expect(broadcast).not.toHaveBeenCalled()
    })
    it("viaWallet forces Adena", async () => {
        qp.quickPlayOn.mockReturnValue(true)
        await play("g1me", 3, 4, 0, { viaWallet: true })
        expect(qp.quickPlayCall).not.toHaveBeenCalled()
        expect(broadcast).toHaveBeenCalledTimes(1)
    })
})
