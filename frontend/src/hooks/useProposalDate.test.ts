/**
 * useProposalDate — the late-arriving exact date must win.
 *
 * On a cold ProposalView visit the hook first resolves with createdAt still
 * undefined (the detail query hasn't landed) and can settle on the tx-search
 * approximation (or null). A resolve-once ref used to freeze that first
 * answer; when the daokit detail's exact chain-rendered createdAt arrived,
 * the hook ignored it — DAOHome and ProposalView showed different dates for
 * the same proposal.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { useProposalDate } from "./useProposalDate"
import { resolveProposalTimestamp } from "../lib/dao/proposalDates"

vi.mock("../lib/dao/proposalDates", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../lib/dao/proposalDates")>()),
    resolveProposalTimestamp: vi.fn(),
}))

const mockResolve = vi.mocked(resolveProposalTimestamp)

beforeEach(() => {
    mockResolve.mockReset()
})

describe("useProposalDate", () => {
    it("re-resolves when the exact createdAt arrives after the first (dateless) resolution", async () => {
        const exactDate = new Date("2026-08-27T10:12:05+00:00")
        mockResolve.mockImplementation(async (_realm, _id, createdAt) =>
            createdAt
                ? { date: exactDate, block: null, exact: true, label: "Aug 27, 2026" }
                : null,
        )

        const { result, rerender } = renderHook(
            ({ createdAt }: { createdAt?: string }) =>
                useProposalDate("gno.land/r/samcrew/memba_dao", 1, createdAt),
            { initialProps: { createdAt: undefined as string | undefined } },
        )

        // First pass: no createdAt yet → resolver returns null.
        await waitFor(() => expect(mockResolve).toHaveBeenCalledTimes(1))
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.timestamp).toBeNull()

        // Detail lands with the exact date → the hook must resolve again.
        rerender({ createdAt: "2026-08-27T10:12:05+00:00" })

        await waitFor(() => expect(result.current.timestamp).not.toBeNull())
        expect(result.current.timestamp!.exact).toBe(true)
        expect(result.current.timestamp!.date).toEqual(exactDate)
        expect(mockResolve).toHaveBeenCalledTimes(2)
    })

    it("does not re-resolve while inputs are stable", async () => {
        mockResolve.mockResolvedValue(null)

        const { result, rerender } = renderHook(() =>
            useProposalDate("gno.land/r/samcrew/memba_dao", 2, "2026-08-20T09:00:00+00:00"),
        )

        await waitFor(() => expect(mockResolve).toHaveBeenCalledTimes(1))
        rerender()
        rerender()
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(mockResolve).toHaveBeenCalledTimes(1)
    })
})
