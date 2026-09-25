import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./api", () => ({
    api: { getProfile: vi.fn(), updateProfile: vi.fn() },
}))

import { api } from "./api"
import { updateBackendProfile } from "./profile"
import type { Token } from "../gen/memba/v1/memba_pb"

const getProfile = vi.mocked(api.getProfile)
const updateProfile = vi.mocked(api.updateProfile)

const ADDR = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const token = { userAddress: ADDR } as unknown as Token

const STORED = {
    address: ADDR,
    bio: "gno builder",
    company: "Samourai",
    title: "Engineer",
    avatarUrl: "https://example.com/a.png",
    twitter: "@me",
    github: "https://github.com/old",
    website: "https://example.com",
    updatedAt: "2026-09-01T00:00:00Z",
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sentProfile = () => (updateProfile.mock.calls[0][0] as any).profile

describe("updateBackendProfile partial updates", () => {
    beforeEach(() => {
        getProfile.mockReset()
        updateProfile.mockReset()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        updateProfile.mockResolvedValue({} as any)
    })

    it("preserves every stored field it was not given", async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getProfile.mockResolvedValue({ profile: STORED } as any)

        await updateBackendProfile(token, { github: "https://github.com/new" })

        expect(getProfile).toHaveBeenCalledWith({ address: ADDR })
        expect(updateProfile).toHaveBeenCalledTimes(1)
        expect(sentProfile()).toEqual({
            address: ADDR,
            bio: "gno builder",
            company: "Samourai",
            title: "Engineer",
            avatarUrl: "https://example.com/a.png",
            twitter: "@me",
            github: "https://github.com/new",
            website: "https://example.com",
        })
    })

    it("clears a field explicitly set to an empty string", async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getProfile.mockResolvedValue({ profile: STORED } as any)

        await updateBackendProfile(token, { github: "" })

        expect(sentProfile().github).toBe("")
        expect(sentProfile().bio).toBe("gno builder")
        expect(sentProfile().website).toBe("https://example.com")
    })

    it("does not write anything when the current profile cannot be read", async () => {
        getProfile.mockRejectedValue(new Error("backend unavailable"))

        await expect(updateBackendProfile(token, { github: "https://github.com/new" })).rejects.toThrow(/nothing was saved/)
        expect(updateProfile).not.toHaveBeenCalled()
    })

    it("does not write anything when the read returns no profile", async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getProfile.mockResolvedValue({} as any)

        await expect(updateBackendProfile(token, { github: "https://github.com/new" })).rejects.toThrow(/nothing was saved/)
        expect(updateProfile).not.toHaveBeenCalled()
    })

    it("sends a full form unchanged", async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getProfile.mockResolvedValue({ profile: STORED } as any)
        const form = {
            bio: "new bio", company: "", title: "CTO", avatarUrl: "",
            twitter: "", github: "", website: "https://new.example",
        }

        await updateBackendProfile(token, form)

        expect(sentProfile()).toEqual({ address: ADDR, ...form })
    })
})
