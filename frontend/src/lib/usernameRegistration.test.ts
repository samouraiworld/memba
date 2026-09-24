import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./rpcFallback", async (orig) => ({
    ...(await orig<typeof import("./rpcFallback")>()),
    resilientAbciQuery: vi.fn(),
}))

import { resilientAbciQuery } from "./rpcFallback"
import { NETWORKS } from "./config"
import {
    buildRegisterUsernameMsg,
    fetchRegisterPrice,
    nymNameProblem,
    parseInt64Result,
    registrationErrorMessage,
} from "./usernameRegistration"

const query = vi.mocked(resilientAbciQuery)
const REGISTRAR = "gno.land/r/sys/namereg/v0"
const CALLER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"

describe("mainnet registrar config", () => {
    it("registers through r/sys/namereg/v0, not r/sys/users", () => {
        // r/sys/users has no public Register on gnoland-1; r/gnoland/users/v1 does not exist there.
        expect(NETWORKS.mainnet.usernameRegistrarPath).toBe(REGISTRAR)
    })

    it("has no registrar on networks where none was verified", () => {
        for (const [key, net] of Object.entries(NETWORKS)) {
            if (key !== "mainnet") expect(net.usernameRegistrarPath).toBeUndefined()
        }
    })
})

describe("nymNameProblem", () => {
    it("accepts the registrar's format", () => {
        expect(nymNameProblem("nym-builder042")).toBeNull()
        expect(nymNameProblem("nym-abcde000")).toBeNull()
        expect(nymNameProblem("nym-abcdefghijklm999")).toBeNull()
    })

    it("rejects names outside nym-[a-z]{5,13}\\d{3}", () => {
        for (const bad of ["zooma_dev", "nym-abcd123", "nym-abcdefghijklmn123", "nym-builder42", "nym-build3r042", "NYM-builder042", ""]) {
            expect(nymNameProblem(bad), bad).not.toBeNull()
        }
    })

    it("rejects reserved stem prefixes", () => {
        expect(nymNameProblem("nym-gnofan123")).toMatch(/gno/)
        expect(nymNameProblem("nym-glider123")).toMatch(/gl/)
        expect(nymNameProblem("nym-cosmosfan123")).toMatch(/cosmos/)
    })
})

describe("register price", () => {
    beforeEach(() => { query.mockReset() })

    it("parses the qeval literal", () => {
        expect(parseInt64Result("(0 int64)")).toBe(0n)
        expect(parseInt64Result("(250000 int64)\n")).toBe(250000n)
        expect(parseInt64Result("(undefined)")).toBeNull()
    })

    it("reads registerPrice from the registrar", async () => {
        query.mockResolvedValue("(0 int64)") // verbatim gnoland-1 output, 2026-09-24
        expect(await fetchRegisterPrice(REGISTRAR)).toBe(0n)
        expect(query).toHaveBeenCalledWith("vm/qeval", `${REGISTRAR}.registerPrice`, true)
    })

    it("returns null when the price cannot be read", async () => {
        query.mockRejectedValue(new Error("RPC down"))
        expect(await fetchRegisterPrice(REGISTRAR)).toBeNull()
    })
})

describe("buildRegisterUsernameMsg", () => {
    it("sends nothing when registration is free", () => {
        expect(buildRegisterUsernameMsg(CALLER, REGISTRAR, "nym-builder042", 0n)).toEqual({
            type: "vm/MsgCall",
            value: { caller: CALLER, send: "", pkg_path: REGISTRAR, func: "Register", args: ["nym-builder042"] },
        })
    })

    it("sends exactly the current price otherwise", () => {
        expect(buildRegisterUsernameMsg(CALLER, REGISTRAR, "nym-builder042", 1_000_000n).value.send).toBe("1000000ugnot")
    })
})

describe("registrationErrorMessage", () => {
    it("maps the registry's errors", () => {
        expect(registrationErrorMessage("r/sys/users: name/Alias already taken")).toMatch(/already taken/)
        expect(registrationErrorMessage("r/sys/users: name collides with a confusable variant of an existing name")).toMatch(/too close/)
        expect(registrationErrorMessage("r/sys/users: username for this address already registered - try creating an Alias")).toMatch(/already has a username/)
        expect(registrationErrorMessage("r/gnoland/users: invalid payment amount")).toMatch(/price changed/)
        expect(registrationErrorMessage("namereg: stem matches a reserved role name")).toMatch(/reserved/)
    })
})
