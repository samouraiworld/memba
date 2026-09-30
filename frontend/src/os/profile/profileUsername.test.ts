import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../lib/config", async (original) => ({ ...(await original<typeof import("../../lib/config")>()), getUsernameRegistrarPath: () => "gno.land/r/sys/namereg/v0" }))
vi.mock("../../lib/usernameRegistration", async (original) => ({ ...(await original<typeof import("../../lib/usernameRegistration")>()), fetchRegisterPrice: vi.fn() }))
vi.mock("../../lib/grc20", async (original) => ({ ...(await original<typeof import("../../lib/grc20")>()), freshFeeForGasWanted: vi.fn(), doContractBroadcast: vi.fn() }))
vi.mock("../../lib/dao/shared", async (original) => ({ ...(await original<typeof import("../../lib/dao/shared")>()), resolveUsernameToAddress: vi.fn(), forgetRegisteredUsername: vi.fn() }))

import { resolveUsernameToAddress } from "../../lib/dao/shared"
import { doContractBroadcast, FALLBACK_GAS_PRICE, freshFeeForGasWanted } from "../../lib/grc20"
import { fetchRegisterPrice } from "../../lib/usernameRegistration"
import { usernameRegistrationRequest } from "./profileUsername"

const ADDRESS = "g1manfred47kzduec920z88wfr64ylksmdcedlf5"

describe("OS username registration review", () => {
    beforeEach(() => { vi.mocked(fetchRegisterPrice).mockReset(); vi.mocked(resolveUsernameToAddress).mockReset() })

    it("reviews the exact live price and refuses a changed price before signing", async () => {
        vi.mocked(fetchRegisterPrice).mockResolvedValueOnce(17n).mockResolvedValueOnce(18n)
        const request = await usernameRegistrationRequest(ADDRESS, "nym-builder042", FALLBACK_GAS_PRICE, vi.fn())
        expect(request.prepare(undefined).msgs[0].value).toMatchObject({ caller: ADDRESS, send: "17ugnot", func: "Register", args: ["nym-builder042"], max_deposit: "660000ugnot" })
        expect(request.lines(undefined)).toContainEqual(["Registration price", "0.000017 GNOT"])
        await expect(request.recheck?.(undefined)).rejects.toThrow("price changed")
        expect(resolveUsernameToAddress).not.toHaveBeenCalled()
    })

    it("refuses a name that became registered", async () => {
        vi.mocked(fetchRegisterPrice).mockResolvedValue(0n)
        vi.mocked(resolveUsernameToAddress).mockResolvedValue(ADDRESS)
        const request = await usernameRegistrationRequest(ADDRESS, "nym-builder042", FALLBACK_GAS_PRICE, vi.fn())
        await expect(request.recheck?.(undefined)).rejects.toThrow("already registered")
    })

    it("states every cost of a free registration and sends the measured gas limit", async () => {
        vi.mocked(fetchRegisterPrice).mockResolvedValue(0n)
        vi.mocked(resolveUsernameToAddress).mockResolvedValue("")
        const request = await usernameRegistrationRequest(ADDRESS, "nym-builder042", FALLBACK_GAS_PRICE, vi.fn())
        expect(request.lines(undefined)).toEqual(expect.arrayContaining([
            ["Registration price", "Free"],
            ["Storage deposit", "≈ 0.33 GNOT (cap 0.66 GNOT), not returned"],
            ["Network fee", "0.108 GNOT"],
        ]))
        expect(request.note).toContain("locked permanently")
        vi.mocked(freshFeeForGasWanted).mockImplementationOnce(async (gas) => Math.ceil(gas * 1.2 * 2 / 1000))
        await expect(request.recheck?.(undefined)).rejects.toThrow("fee increased")
        vi.mocked(doContractBroadcast).mockResolvedValueOnce({ hash: "hash" })
        const beforeSign = vi.fn()
        await request.send(undefined, beforeSign)
        expect(doContractBroadcast).toHaveBeenCalledWith(request.prepare(undefined).msgs, "Register @nym-builder042", { gasWanted: 90_000_000, gasFee: 108_000, retry: false, beforeSign })
    })
})
