/**
 * SelfReportForm.test.tsx — claim-status-aware proof submission.
 *
 * The backend claim status (via fetchQuestClaimStatuses) is the source of
 * truth: a REJECTED claim must show the rejection and re-open the form so the
 * user can resubmit better proof (backend PR reopens rejected claims as
 * pending). localStorage (hasSubmittedClaim) is only an optimistic hint used
 * while loading or when the backend is unreachable — it must never permanently
 * hide the form anymore.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import { create } from "@bufbuild/protobuf"
import { TokenSchema } from "../../gen/memba/v1/memba_pb"

const fetchQuestClaimStatusesMock = vi.fn()
const hasSubmittedClaimMock = vi.fn()
const submitQuestClaimMock = vi.fn()
vi.mock("../../lib/questClaims", () => ({
    fetchQuestClaimStatuses: (...args: unknown[]) => fetchQuestClaimStatusesMock(...args),
    hasSubmittedClaim: (...args: unknown[]) => hasSubmittedClaimMock(...args),
    submitQuestClaim: (...args: unknown[]) => submitQuestClaimMock(...args),
}))

import { SelfReportForm } from "./SelfReportForm"

const token = create(TokenSchema, {})

function statuses(entries: Record<string, string>) {
    const map = new Map<string, { status: string; createdAt: string; reviewedAt: string }>()
    for (const [questId, status] of Object.entries(entries)) {
        map.set(questId, { status, createdAt: "2026-07-01 10:00:00", reviewedAt: status === "pending" ? "" : "2026-07-01 12:00:00" })
    }
    return map
}

describe("SelfReportForm", () => {
    beforeEach(() => {
        fetchQuestClaimStatusesMock.mockReset()
        hasSubmittedClaimMock.mockReset().mockReturnValue(false)
        submitQuestClaimMock.mockReset()
    })

    it("shows the form when there is no claim", async () => {
        fetchQuestClaimStatusesMock.mockResolvedValue(statuses({}))

        render(<SelfReportForm questId="fix-upstream-bug" address="g1alice" authToken={token} />)

        await waitFor(() => expect(screen.getByRole("button", { name: /submit proof/i })).toBeTruthy())
        expect(screen.getByLabelText("Proof URL")).toBeTruthy()
    })

    it("shows the pending banner (no form) for a pending claim", async () => {
        fetchQuestClaimStatusesMock.mockResolvedValue(statuses({ "fix-upstream-bug": "pending" }))

        render(<SelfReportForm questId="fix-upstream-bug" address="g1alice" authToken={token} />)

        await waitFor(() => expect(screen.getByText(/pending admin review/i)).toBeTruthy())
        expect(screen.queryByRole("button", { name: /submit proof/i })).toBeNull()
    })

    it("shows the approved banner for an approved claim", async () => {
        fetchQuestClaimStatusesMock.mockResolvedValue(statuses({ "fix-upstream-bug": "approved" }))

        render(<SelfReportForm questId="fix-upstream-bug" address="g1alice" authToken={token} />)

        await waitFor(() => expect(screen.getByText(/approved/i)).toBeTruthy())
        expect(screen.queryByRole("button", { name: /submit/i })).toBeNull()
    })

    it("shows the rejection notice AND re-opens the form for a rejected claim", async () => {
        fetchQuestClaimStatusesMock.mockResolvedValue(statuses({ "fix-upstream-bug": "rejected" }))

        render(<SelfReportForm questId="fix-upstream-bug" address="g1alice" authToken={token} />)

        await waitFor(() => expect(screen.getByText(/rejected/i)).toBeTruthy())
        // The form must be usable again for a resubmission with better proof.
        expect(screen.getByLabelText("Proof URL")).toBeTruthy()
        expect(screen.getByRole("button", { name: /resubmit proof/i })).toBeTruthy()
    })

    it("lets a rejected user resubmit, then shows pending", async () => {
        fetchQuestClaimStatusesMock.mockResolvedValue(statuses({ "fix-upstream-bug": "rejected" }))
        submitQuestClaimMock.mockResolvedValue(undefined)

        render(<SelfReportForm questId="fix-upstream-bug" address="g1alice" authToken={token} />)
        await waitFor(() => expect(screen.getByText(/rejected/i)).toBeTruthy())

        fireEvent.change(screen.getByLabelText("Proof URL"), { target: { value: "https://example.com/pr/2" } })
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: /resubmit proof/i }))
        })

        expect(submitQuestClaimMock).toHaveBeenCalledWith(token, "g1alice", "fix-upstream-bug", "https://example.com/pr/2", "")
        await waitFor(() => expect(screen.getByText(/pending admin review/i)).toBeTruthy())
    })

    it("falls back to the localStorage hint (pending) when the backend is unreachable", async () => {
        fetchQuestClaimStatusesMock.mockResolvedValue(null)
        hasSubmittedClaimMock.mockReturnValue(true)

        render(<SelfReportForm questId="fix-upstream-bug" address="g1alice" authToken={token} />)

        await waitFor(() => expect(fetchQuestClaimStatusesMock).toHaveBeenCalled())
        expect(screen.getByText(/pending admin review/i)).toBeTruthy()
    })

    it("trusts the backend over a stale localStorage hint (shows the form)", async () => {
        // Local hint says "submitted" but the backend has no claim on record
        // (e.g. the submit never landed): the form must come back.
        fetchQuestClaimStatusesMock.mockResolvedValue(statuses({}))
        hasSubmittedClaimMock.mockReturnValue(true)

        render(<SelfReportForm questId="fix-upstream-bug" address="g1alice" authToken={token} />)

        await waitFor(() => expect(screen.getByRole("button", { name: /submit proof/i })).toBeTruthy())
    })

    it("shows pending after a fresh successful submission", async () => {
        fetchQuestClaimStatusesMock.mockResolvedValue(statuses({}))
        submitQuestClaimMock.mockResolvedValue(undefined)

        render(<SelfReportForm questId="fix-upstream-bug" address="g1alice" authToken={token} />)
        await waitFor(() => expect(screen.getByRole("button", { name: /submit proof/i })).toBeTruthy())

        fireEvent.change(screen.getByLabelText("Proof URL"), { target: { value: "https://example.com/pr/1" } })
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: /submit proof/i }))
        })

        await waitFor(() => expect(screen.getByText(/pending admin review/i)).toBeTruthy())
    })

    it("shows an error and keeps the form when submission fails", async () => {
        fetchQuestClaimStatusesMock.mockResolvedValue(statuses({}))
        submitQuestClaimMock.mockRejectedValue(new Error("boom"))

        render(<SelfReportForm questId="fix-upstream-bug" address="g1alice" authToken={token} />)
        await waitFor(() => expect(screen.getByRole("button", { name: /submit proof/i })).toBeTruthy())

        fireEvent.change(screen.getByLabelText("Proof URL"), { target: { value: "https://x" } })
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: /submit proof/i }))
        })

        await waitFor(() => expect(screen.getByText(/submission failed/i)).toBeTruthy())
        expect(screen.getByRole("button", { name: /submit proof/i })).toBeTruthy()
    })
})
