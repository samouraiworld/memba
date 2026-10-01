import { beforeEach, describe, expect, it, vi } from "vitest"

const queryEval = vi.fn()
vi.mock("./dao/shared", async (load) => ({
    ...(await load<typeof import("./dao/shared")>()),
    queryEval: (...args: unknown[]) => queryEval(...args),
}))
vi.mock("./config", async (load) => ({
    ...(await load<typeof import("./config")>()),
    ACTIVE_NETWORK_KEY: "mainnet",
    GNO_RPC_URL: "https://rpc.example",
    currentNetworkKey: () => "mainnet",
    isRealmValidOn: () => true,
}))

import { parseActionStatus, readActionStatus, TOKEN_LAUNCHPAD_CONFIG_PATH } from "./tokenLaunchpadConfigClient"

const status = { schema: "launchpad-config-action-v1", lane: "fairsale", currency: "ugnot", version: "4", paused: false, allowlisted: true, laneReady: true, configGateOpen: true }
const qjson = (value: unknown) => `(${JSON.stringify(JSON.stringify(value))} string)`

beforeEach(() => queryEval.mockReset())

describe("Token Launchpad config gate reader", () => {
    it("reads a lane's gate with an exact expression", async () => {
        queryEval.mockResolvedValueOnce(qjson(status))
        expect(await readActionStatus("mainnet", "fairsale", "ugnot")).toEqual({ lane: "fairsale", currency: "ugnot", version: 4n, paused: false, allowlisted: true, laneReady: true, open: true })
        expect(queryEval).toHaveBeenCalledWith("https://rpc.example", TOKEN_LAUNCHPAD_CONFIG_PATH, 'ActionStatusJSON("fairsale", "ugnot")', true)
    })

    it("refuses a gate that contradicts its parts, or answers for another lane or currency", () => {
        expect(parseActionStatus({ ...status, paused: true, configGateOpen: false }, "fairsale", "ugnot").open).toBe(false)
        for (const value of [
            { ...status, paused: true }, { ...status, laneReady: false }, { ...status, allowlisted: false },
            { ...status, lane: "direct" }, { ...status, currency: "uatom" }, { ...status, schema: "v2" },
            { ...status, version: "0" }, { ...status, version: 4 }, { ...status, version: "9223372036854775808" },
        ]) expect(() => parseActionStatus(value, "fairsale", "ugnot"), JSON.stringify(value)).toThrow()
    })

    it("asks nothing for an empty or oversized currency", async () => {
        await expect(readActionStatus("mainnet", "direct", "")).rejects.toMatchObject({ code: "invalid_response" })
        await expect(readActionStatus("mainnet", "direct", "x".repeat(201))).rejects.toMatchObject({ code: "invalid_response" })
        expect(queryEval).not.toHaveBeenCalled()
    })
})
