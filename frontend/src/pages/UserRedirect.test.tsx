import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom"

vi.mock("../lib/rpcFallback", async (orig) => ({
    ...(await orig<typeof import("../lib/rpcFallback")>()),
    resilientAbciQuery: vi.fn(),
    resilientFetch: vi.fn(),
}))

vi.mock("../lib/dao/chainIdentity", async (orig) => ({
    ...(await orig<typeof import("../lib/dao/chainIdentity")>()),
    assertActiveRpcChain: vi.fn(async () => undefined),
}))

import { resilientAbciQuery, resilientFetch } from "../lib/rpcFallback"
import { assertActiveRpcChain } from "../lib/dao/chainIdentity"
import { parseResolveNameResult, resolveUsernameToAddress } from "../lib/dao/shared"
import { UserRedirect } from "./UserRedirect"

const query = vi.mocked(resilientAbciQuery)
const SAMCREW = "g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf"
// Verbatim gnoland-1 qeval output of r/sys/users.ResolveName (read-only query
// 2026-09-24, node_info.network "gnoland-1").
const LIVE_SAMCREW = `(&(struct{("${SAMCREW}" .uverse.address),("samcrew" string),(false bool)} gno.land/r/sys/users.UserData) *gno.land/r/sys/users.UserData)\n(true bool)`
const LIVE_NIL = "(nil *gno.land/r/sys/users.UserData)\n(false bool)"
// What r/sys/users.Render returns for ANY path: its home page. The old
// resolver scraped the first g1 address out of this kind of output.
const HOME_PAGE_WITH_ADDRESS = "# r/sys/users\n\nController: g1t2a5cfc8y860kzp6yf7fsnfm3dq0a5dxx5svzy\n"

describe("parseResolveNameResult", () => {
    it("returns the owner's address", () => {
        expect(parseResolveNameResult(LIVE_SAMCREW)).toBe(SAMCREW)
    })

    it("still resolves a previous name to its user", () => {
        expect(parseResolveNameResult(LIVE_SAMCREW.replace("(true bool)", "(false bool)"))).toBe(SAMCREW)
    })

    it("returns empty for an unregistered name", () => {
        expect(parseResolveNameResult(LIVE_NIL)).toBe("")
    })

    it("returns empty for a deleted user", () => {
        expect(parseResolveNameResult(LIVE_SAMCREW.replace("(false bool)}", "(true bool)}"))).toBe("")
    })

    it("rejects anything that is not the UserData literal, render output included", () => {
        expect(parseResolveNameResult(HOME_PAGE_WITH_ADDRESS)).toBeNull()
        expect(parseResolveNameResult("")).toBeNull()
    })
})

describe("resolveUsernameToAddress", () => {
    beforeEach(() => {
        query.mockReset()
        vi.mocked(resilientFetch).mockReset()
    })

    it("queries the registry's ResolveName, never its render", async () => {
        query.mockResolvedValue(LIVE_SAMCREW)
        expect(await resolveUsernameToAddress("samcrew")).toBe(SAMCREW)
        expect(query).toHaveBeenCalledWith("vm/qeval", 'gno.land/r/sys/users.ResolveName("samcrew")', true)
        expect(resilientFetch).not.toHaveBeenCalled()
    })

    it("verifies the RPC serves the active chain before trusting the answer", async () => {
        vi.mocked(assertActiveRpcChain).mockRejectedValueOnce(new Error("RPC serves another chain"))
        expect(await resolveUsernameToAddress("samcrew")).toBeNull()
        expect(query).not.toHaveBeenCalled()
    })

    it("lowercases the name, as the registry only holds lowercase names", async () => {
        query.mockResolvedValue(LIVE_SAMCREW)
        expect(await resolveUsernameToAddress("SamCrew")).toBe(SAMCREW)
        expect(query).toHaveBeenCalledWith("vm/qeval", 'gno.land/r/sys/users.ResolveName("samcrew")', true)
    })

    it("accepts a leading @", async () => {
        query.mockResolvedValue(LIVE_SAMCREW)
        expect(await resolveUsernameToAddress("@samcrew")).toBe(SAMCREW)
        expect(query).toHaveBeenCalledWith("vm/qeval", 'gno.land/r/sys/users.ResolveName("samcrew")', true)
    })

    it("never interpolates an invalid name into the query", async () => {
        expect(await resolveUsernameToAddress('x") + evil("')).toBe("")
        expect(await resolveUsernameToAddress("a".repeat(65))).toBe("")
        expect(query).not.toHaveBeenCalled()
    })

    it("returns null when the registry cannot be read", async () => {
        query.mockRejectedValue(new Error("RPC down"))
        expect(await resolveUsernameToAddress("samcrew")).toBeNull()
    })
})

function ProfileProbe() {
    const { network, address } = useParams()
    return <p>profile {network} {address}</p>
}

function renderAt(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/:network/u/:username" element={<UserRedirect />} />
                <Route path="/:network/profile/:address" element={<ProfileProbe />} />
            </Routes>
        </MemoryRouter>,
    )
}

describe("UserRedirect", () => {
    beforeEach(() => { query.mockReset() })

    it("redirects a registered username to that user's profile", async () => {
        query.mockResolvedValue(LIVE_SAMCREW)
        renderAt("/mainnet/u/samcrew")
        expect(await screen.findByText(`profile mainnet ${SAMCREW}`)).toBeTruthy()
    })

    it("shows not-found for an unregistered name", async () => {
        query.mockResolvedValue(LIVE_NIL)
        renderAt("/mainnet/u/nobody_here")
        expect(await screen.findByText("User not found")).toBeTruthy()
    })

    it("says the registry is unreachable instead of claiming the user does not exist", async () => {
        query.mockRejectedValue(new Error("RPC down"))
        renderAt("/mainnet/u/samcrew")
        expect(await screen.findByText("Couldn't look up this user")).toBeTruthy()
    })
})
