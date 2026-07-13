import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import type { CertifyRun } from "./BarricadeCertify"

// Mock the wallet-backed hook so the component test never touches Adena.
const certify = vi.fn()
let mockStatus = "idle"
let mockError: string | null = null
vi.mock("./hooks/useArcadeCertify", () => ({
    useArcadeCertify: () => ({ certify, status: mockStatus, error: mockError, result: null }),
}))

import BarricadeCertify from "./BarricadeCertify"

const run: CertifyRun = {
    seed: "barricade-2026-07-13",
    simVersion: 2,
    events: [{ tick: 60, type: "move", lane: 1 }],
    claimedScore: 27150,
    claimedHash: "abc",
}

describe("BarricadeCertify", () => {
    beforeEach(() => {
        certify.mockReset()
        mockStatus = "idle"
        mockError = null
    })

    it("certifies the given run on click", () => {
        render(<BarricadeCertify run={run} />)
        fireEvent.click(screen.getByRole("button", { name: /certify on-chain/i }))
        expect(certify).toHaveBeenCalledWith({
            seed: "barricade-2026-07-13",
            simVersion: 2,
            events: run.events,
            claimedScore: 27150,
            claimedHash: "abc",
        })
    })

    it("disables the button while certifying", () => {
        mockStatus = "certifying"
        render(<BarricadeCertify run={run} />)
        expect(screen.getByRole("button")).toBeDisabled()
    })

    it("shows a success line when certified (no button)", () => {
        mockStatus = "certified"
        render(<BarricadeCertify run={run} />)
        expect(screen.queryByRole("button")).toBeNull()
        expect(screen.getByText(/certified on-chain/i)).toBeInTheDocument()
    })

    it("surfaces an error message", () => {
        mockStatus = "error"
        mockError = "claim does not match the re-simulation"
        render(<BarricadeCertify run={run} />)
        expect(screen.getByText(/claim does not match/i)).toBeInTheDocument()
    })
})
