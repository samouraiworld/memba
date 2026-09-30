import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./rpcFallback", async (orig) => ({
    ...(await orig<typeof import("./rpcFallback")>()),
    resilientAbciQuery: vi.fn(),
}))

import { resilientAbciQuery } from "./rpcFallback"
import { NETWORKS } from "./config"
import {
    buildRegisterUsernameMsg,
    REGISTER_DEPOSIT_UGNOT,
    REGISTER_GAS_WANTED,
    REGISTER_MAX_DEPOSIT_UGNOT,
    registerBroadcastOptions,
    fetchRegisterPrice,
    nymNameProblem,
    parseInt64Result,
    registrationErrorMessage,
} from "./usernameRegistration"

const query = vi.mocked(resilientAbciQuery)
const REGISTRAR = "gno.land/r/sys/namereg/v0"
const CALLER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"

describe("registrar config", () => {
    it("registers through r/sys/namereg/v0, not r/sys/users, on mainnet and on Onyx", () => {
        // r/sys/users has no public Register on gnoland-1; r/gnoland/users/v1 does not exist there.
        // onyx-1 runs the same code line: its r/sys/users controller is namereg/v0 too.
        expect(NETWORKS.mainnet.usernameRegistrarPath).toBe(REGISTRAR)
        expect(NETWORKS.onyx.usernameRegistrarPath).toBe(REGISTRAR)
    })

    it("has no registrar on networks where none was verified", () => {
        for (const [key, net] of Object.entries(NETWORKS)) {
            if (key !== "mainnet" && key !== "onyx") expect(net.usernameRegistrarPath).toBeUndefined()
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
    it("sends nothing when registration is free, and caps the storage deposit", () => {
        expect(buildRegisterUsernameMsg(CALLER, REGISTRAR, "nym-builder042", 0n)).toEqual({
            type: "vm/MsgCall",
            value: { caller: CALLER, send: "", pkg_path: REGISTRAR, func: "Register", args: ["nym-builder042"], max_deposit: "660000ugnot" },
        })
    })

    // `.app/simulate` on gnoland-1, 2026-09-30: the highest of about 100 sampled names used 42,535,264 gas and 3,253 bytes.
    it("budgets at least twice the measured gas, and a deposit cap of twice the storage estimate", () => {
        expect(REGISTER_GAS_WANTED).toBeGreaterThanOrEqual(2 * 42_535_264)
        expect(REGISTER_DEPOSIT_UGNOT).toBeGreaterThanOrEqual(3_253 * 100)
        expect(REGISTER_MAX_DEPOSIT_UGNOT).toBe(2 * REGISTER_DEPOSIT_UGNOT)
    })

    it("broadcasts once, with the measured limit and the fee for the quoted price", () => {
        expect(registerBroadcastOptions({ gas: 1000, ugnot: 1 })).toEqual({ gasWanted: 90_000_000, gasFee: 108_000 })
        expect(registerBroadcastOptions({ gas: 1000, ugnot: 2 }).gasFee).toBe(216_000)
    })

    it("names the deposit when the wallet cannot cover the registration", () => {
        expect(registrationErrorMessage("insufficient coins error")).toBe("Not enough GNOT to pay the network fee and the storage deposit.")
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
