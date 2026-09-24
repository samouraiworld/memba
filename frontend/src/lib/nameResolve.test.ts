import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./rpcFallback", async (orig) => ({
    ...(await orig<typeof import("./rpcFallback")>()),
    resilientAbciQuery: vi.fn(),
}))

vi.mock("./dao/chainIdentity", async (orig) => ({
    ...(await orig<typeof import("./dao/chainIdentity")>()),
    assertActiveRpcChain: vi.fn(async () => undefined),
}))

// Pass-through by default, so most tests run the real resolver over the
// mocked ABCI layer; single tests override it to simulate a throw.
vi.mock("./dao/shared", async (orig) => {
    const actual = await orig<typeof import("./dao/shared")>()
    return { ...actual, resolveUsernameToAddress: vi.fn(actual.resolveUsernameToAddress) }
})

import { resilientAbciQuery } from "./rpcFallback"
import { resolveUsernameToAddress } from "./dao/shared"
import { resolveRecipient } from "./nameResolve"

const query = vi.mocked(resilientAbciQuery)
const SAMCREW = "g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf"
// Verbatim gnoland-1 qeval outputs of r/sys/users.ResolveName (read-only
// queries, node_info.network "gnoland-1").
const LIVE_SAMCREW = `(&(struct{("${SAMCREW}" .uverse.address),("samcrew" string),(false bool)} gno.land/r/sys/users.UserData) *gno.land/r/sys/users.UserData)\n(true bool)`
const LIVE_NIL = "(nil *gno.land/r/sys/users.UserData)\n(false bool)"

function lookedUp(name: string) {
    expect(query).toHaveBeenCalledWith("vm/qeval", `gno.land/r/sys/users.ResolveName(${JSON.stringify(name)})`, true)
}

beforeEach(() => {
    query.mockReset()
    vi.mocked(resolveUsernameToAddress).mockClear()
})

describe("resolveRecipient: addresses", () => {
    it("accepts a valid g1 address with no network call", async () => {
        expect(await resolveRecipient(SAMCREW)).toEqual({ kind: "address", address: SAMCREW })
        expect(query).not.toHaveBeenCalled()
        expect(resolveUsernameToAddress).not.toHaveBeenCalled()
    })

    it("trims surrounding whitespace", async () => {
        expect(await resolveRecipient(`  ${SAMCREW}\n`)).toEqual({ kind: "address", address: SAMCREW })
    })

    it("rejects a bad checksum", async () => {
        const typo = SAMCREW.slice(0, -1) + (SAMCREW.endsWith("f") ? "g" : "f")
        const r = await resolveRecipient(typo)
        expect(r.kind).toBe("invalid")
        expect(query).not.toHaveBeenCalled()
    })

    it("rejects a mistyped address with an extra character instead of looking it up as a name", async () => {
        expect((await resolveRecipient(SAMCREW + "q")).kind).toBe("invalid")
        expect(query).not.toHaveBeenCalled()
    })

    it("accepts an all-uppercase address as its lowercase form", async () => {
        expect(await resolveRecipient(SAMCREW.toUpperCase())).toEqual({ kind: "address", address: SAMCREW })
    })

    it("rejects a mixed-case address", async () => {
        const r = await resolveRecipient("G" + SAMCREW.slice(1))
        expect(r).toEqual({ kind: "invalid", reason: expect.stringMatching(/mix upper and lower case/) })
    })

    it("rejects an address typed with @: the registry never holds address-shaped names", async () => {
        expect(await resolveRecipient(`@${SAMCREW}`)).toEqual({ kind: "invalid", reason: expect.stringMatching(/Remove the @/) })
        expect(query).not.toHaveBeenCalled()
    })
})

describe("resolveRecipient: names", () => {
    it("resolves a bare name to its owner", async () => {
        query.mockResolvedValue(LIVE_SAMCREW)
        expect(await resolveRecipient("samcrew")).toEqual({ kind: "address", address: SAMCREW, name: "samcrew" })
        lookedUp("samcrew")
    })

    it("strips one leading @", async () => {
        query.mockResolvedValue(LIVE_SAMCREW)
        expect(await resolveRecipient("@samcrew")).toEqual({ kind: "address", address: SAMCREW, name: "samcrew" })
        lookedUp("samcrew")
    })

    it("strips only one @", async () => {
        expect((await resolveRecipient("@@samcrew")).kind).toBe("invalid")
        expect(query).not.toHaveBeenCalled()
    })

    it("trims whitespace around a name", async () => {
        query.mockResolvedValue(LIVE_SAMCREW)
        expect(await resolveRecipient("  @samcrew \t")).toEqual({ kind: "address", address: SAMCREW, name: "samcrew" })
    })

    it("lowercases the name, as the registry only holds lowercase names", async () => {
        query.mockResolvedValue(LIVE_SAMCREW)
        expect(await resolveRecipient("@SamCrew")).toEqual({ kind: "address", address: SAMCREW, name: "samcrew" })
        lookedUp("samcrew")
    })

    it("looks up a short g1-prefixed name, which the registry allows", async () => {
        query.mockResolvedValue(LIVE_NIL)
        expect(await resolveRecipient("g1bob")).toEqual({ kind: "unregistered", name: "g1bob" })
        lookedUp("g1bob")
    })

    it("negative control: a nonexistent name is unregistered, not unreachable", async () => {
        query.mockResolvedValue(LIVE_NIL)
        expect(await resolveRecipient("@nobody_here_42")).toEqual({ kind: "unregistered", name: "nobody_here_42" })
        lookedUp("nobody_here_42")
    })

    it("is unreachable when the RPC fails", async () => {
        query.mockRejectedValue(new Error("RPC down"))
        expect(await resolveRecipient("@samcrew")).toEqual({ kind: "unreachable", name: "samcrew" })
    })

    it("is unreachable when the registry output is unparseable", async () => {
        query.mockResolvedValue("# r/sys/users\n\nController: g1t2a5cfc8y860kzp6yf7fsnfm3dq0a5dxx5svzy\n")
        expect(await resolveRecipient("samcrew")).toEqual({ kind: "unreachable", name: "samcrew" })
    })

    it("never throws, even if the resolver does", async () => {
        vi.mocked(resolveUsernameToAddress).mockRejectedValueOnce(new Error("boom"))
        expect(await resolveRecipient("samcrew")).toEqual({ kind: "unreachable", name: "samcrew" })
    })

    it("never passes on an address the resolver got wrong", async () => {
        vi.mocked(resolveUsernameToAddress).mockResolvedValueOnce(SAMCREW.slice(0, -1) + "q")
        expect(await resolveRecipient("samcrew")).toEqual({ kind: "unreachable", name: "samcrew" })
    })
})

describe("resolveRecipient: non-ASCII input is rejected, never normalised", () => {
    const ASCII_ONLY = { kind: "invalid", reason: expect.stringMatching(/plain ASCII/) }

    it.each([
        // U+212A KELVIN SIGN lowercases to "k": this must not become "kelvin".
        ["a Kelvin sign in a name", "@\u212Aelvin"],
        ["a Kelvin sign in a bare name", "sam\u212Arew"],
        // U+212A is its own uppercase, so it would pass the mixed-case guard.
        ["a Kelvin sign in an uppercase address", SAMCREW.toUpperCase().replace("K", "\u212A")],
        // String.trim() would silently strip these two.
        ["U+FEFF before a name", "\uFEFFsamcrew"],
        ["U+00A0 after a name", "@samcrew\u00A0"],
        ["U+FEFF before an address", "\uFEFF" + SAMCREW],
        ["U+00A0 after an address", SAMCREW + "\u00A0"],
        ["U+200B inside a name", "@sam\u200Bcrew"],
        ["U+200B inside an address", SAMCREW.slice(0, 10) + "\u200B" + SAMCREW.slice(10)],
        ["a fullwidth letter", "\uFF53amcrew"],
    ])("%s", async (_label, input) => {
        expect(SAMCREW.toUpperCase()).toContain("K")
        expect(await resolveRecipient(input)).toEqual(ASCII_ONLY)
        expect(query).not.toHaveBeenCalled()
        expect(resolveUsernameToAddress).not.toHaveBeenCalled()
    })

    it("still trims ASCII space, tab, CR and LF at the edges", async () => {
        query.mockResolvedValue(LIVE_SAMCREW)
        expect(await resolveRecipient(" \t\r\n@samcrew\r\n\t ")).toEqual({ kind: "address", address: SAMCREW, name: "samcrew" })
    })
})

describe("resolveRecipient: invalid input", () => {
    it.each([
        ["", /Enter a @username or a g1 address/],
        ["   ", /Enter a @username or a g1 address/],
        ["@", /Enter a username after the @/],
        ["sam crew", /plain ASCII/],
        ["1samcrew", /start with a letter/],
        ["sam--crew", /start with a letter/],
        ["samcrew_", /start with a letter/],
        ["sam.crew", /start with a letter/],
        ['x") + evil("', /plain ASCII/],
        ['x")+evil("', /start with a letter/],
        ["a".repeat(65), /at most 64 characters/],
    ])("%j is invalid", async (input, reason) => {
        expect(await resolveRecipient(input)).toEqual({ kind: "invalid", reason: expect.stringMatching(reason) })
        expect(query).not.toHaveBeenCalled()
    })

    it("accepts a 64-character name", async () => {
        query.mockResolvedValue(LIVE_NIL)
        expect((await resolveRecipient("a".repeat(64))).kind).toBe("unregistered")
    })

    it("handles a non-string input from untyped callers", async () => {
        expect((await resolveRecipient(undefined as unknown as string)).kind).toBe("invalid")
    })
})
