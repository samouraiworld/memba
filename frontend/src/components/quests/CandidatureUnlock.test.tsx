import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

const authAddress = { value: "g1alice" }
const resolveEligibility = vi.fn()
const onNetwork = { value: true }

vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ address: authAddress.value }) }))
vi.mock("../../hooks/useNetworkNav", () => ({ useNetworkKey: () => "pearl" }))
vi.mock("../../lib/questNetwork", () => ({ isQuestAvailableOnNetwork: () => onNetwork.value }))
vi.mock("../../lib/quests", () => ({
    CANDIDATURE_XP_THRESHOLD: 350,
    resolveCandidatureEligibility: (...args: unknown[]) => resolveEligibility(...args),
}))

import { CandidatureUnlock } from "./CandidatureUnlock"

function show() {
    return render(<MemoryRouter><CandidatureUnlock /></MemoryRouter>)
}

describe("CandidatureUnlock", () => {
    beforeEach(() => {
        authAddress.value = "g1alice"
        onNetwork.value = true
        resolveEligibility.mockReset()
    })

    it("stays locked when local XP is irrelevant and backend verified XP is short", async () => {
        resolveEligibility.mockResolvedValue({ eligible: false, verifiedXP: 40 })
        show()
        await waitFor(() => expect(screen.getByText(/40\/350 verified XP/)).toBeInTheDocument())
        expect(screen.queryByTestId("candidature-unlock-ready")).toBeNull()
    })

    it("unlocks only with backend verified XP on an available network", async () => {
        resolveEligibility.mockResolvedValue({ eligible: true, verifiedXP: 350 })
        show()
        expect(await screen.findByTestId("candidature-unlock-ready")).toBeInTheDocument()
        expect(screen.getByRole("link", { name: /claim candidature/i })).toHaveAttribute("href", "/pearl/candidature")
    })

    it("shows a distinct loading state until verified XP resolves", async () => {
        let resolve!: (value: { eligible: boolean; verifiedXP: number }) => void
        resolveEligibility.mockImplementation(() => new Promise<{ eligible: boolean; verifiedXP: number }>(result => { resolve = result }))
        show()
        expect(screen.getByText("Checking verified XP…")).toBeInTheDocument()
        expect(screen.queryByText("Verified XP unavailable")).toBeNull()
        expect(screen.queryByRole("button", { name: /retry verified XP/i })).toBeNull()

        resolve({ eligible: false, verifiedXP: 40 })
        await waitFor(() => expect(screen.getByText(/40\/350 verified XP/)).toBeInTheDocument())
    })

    it("does not promise candidature where the realm is unavailable", () => {
        onNetwork.value = false
        show()
        expect(screen.getByText(/not available on this network yet/i)).toBeInTheDocument()
        expect(resolveEligibility).not.toHaveBeenCalled()
    })

    it("fails closed while the backend is unreachable", async () => {
        resolveEligibility.mockResolvedValue({ eligible: false, verifiedXP: null })
        show()
        await waitFor(() => expect(screen.getByText(/Verified XP unavailable/)).toBeInTheDocument())
        expect(screen.queryByTestId("candidature-unlock-ready")).toBeNull()
    })

    it("lets a failed verified XP request be retried", async () => {
        resolveEligibility.mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValueOnce({ eligible: true, verifiedXP: 350 })
        show()
        fireEvent.click(await screen.findByRole("button", { name: /retry verified XP/i }))
        expect(await screen.findByTestId("candidature-unlock-ready")).toBeInTheDocument()
        expect(resolveEligibility).toHaveBeenCalledTimes(2)
    })
})
