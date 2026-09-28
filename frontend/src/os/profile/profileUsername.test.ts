import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../lib/config", async (original) => ({ ...(await original<typeof import("../../lib/config")>()), getUsernameRegistrarPath: () => "gno.land/r/sys/namereg/v0" }))
vi.mock("../../lib/usernameRegistration", async (original) => ({ ...(await original<typeof import("../../lib/usernameRegistration")>()), fetchRegisterPrice: vi.fn() }))
vi.mock("../../lib/dao/shared", async (original) => ({ ...(await original<typeof import("../../lib/dao/shared")>()), resolveUsernameToAddress: vi.fn(), forgetRegisteredUsername: vi.fn() }))

import { resolveUsernameToAddress } from "../../lib/dao/shared"
import { fetchRegisterPrice } from "../../lib/usernameRegistration"
import { usernameRegistrationRequest } from "./profileUsername"

const ADDRESS = "g1manfred47kzduec920z88wfr64ylksmdcedlf5"

describe("OS username registration review", () => {
    beforeEach(() => { vi.mocked(fetchRegisterPrice).mockReset(); vi.mocked(resolveUsernameToAddress).mockReset() })

    it("reviews the exact live price and refuses a changed price before signing", async () => {
        vi.mocked(fetchRegisterPrice).mockResolvedValueOnce(17n).mockResolvedValueOnce(18n)
        const request = await usernameRegistrationRequest(ADDRESS, "nym-builder042", vi.fn())
        expect(request.prepare(undefined).msgs[0].value).toMatchObject({ caller: ADDRESS, send: "17ugnot", func: "Register", args: ["nym-builder042"] })
        expect(request.lines(undefined)).toContainEqual(["Registration price", "17 ugnot"])
        await expect(request.recheck?.(undefined)).rejects.toThrow("price changed")
        expect(resolveUsernameToAddress).not.toHaveBeenCalled()
    })

    it("refuses a name that became registered", async () => {
        vi.mocked(fetchRegisterPrice).mockResolvedValue(0n)
        vi.mocked(resolveUsernameToAddress).mockResolvedValue(ADDRESS)
        const request = await usernameRegistrationRequest(ADDRESS, "nym-builder042", vi.fn())
        await expect(request.recheck?.(undefined)).rejects.toThrow("already registered")
    })
})
