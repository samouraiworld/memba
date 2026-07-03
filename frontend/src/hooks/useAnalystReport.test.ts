/**
 * useAnalystReport.test.ts — W4 react-hooks/set-state-in-effect refactor coverage.
 *
 * Pins the behavior of the two refactored sites:
 *   1. Reset-on-context-change now uses the React docs "adjust state during
 *      render" pattern (prev-key guard) instead of a setState-in-effect. The
 *      reset lands one render EARLIER than before (during the render that first
 *      sees the new cacheKey, not after its effects) — the old context's report
 *      is never rendered for the new key, which is strictly better.
 *   2. The auto-fetch effect defers the fetchReport() kickoff by one microtask
 *      (queueMicrotask) so no setState runs synchronously in the effect body.
 *      Externally identical: fetch still happens before paint.
 *
 * Verifies:
 *   1. dao analysis auto-fetches (report populated, session-cached)
 *   2. no auth token → no fetch
 *   3. context change resets report/error synchronously (stale data never shown)
 *   4. context change rehydrates from sessionStorage without a network refetch
 *   5. trigger() forces a refetch (?force=1)
 *   6. proposal analysis never auto-fetches; trigger() fetches on demand
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { useAnalystReport, type ConsensusReport } from "./useAnalystReport"

const REALM = "gno.land/r/samcrew/memba_dao"
const NETWORK = "test13"

const makeReport = (summary: string): ConsensusReport => ({
    consensus: {
        verdict: "approve",
        confidence: 90,
        agreementLevel: "unanimous",
        agreeCount: 3,
        respondedCount: 3,
        totalCount: 3,
        summary,
        keyRisks: [],
        keyRecommendations: [],
    },
    perspectives: [],
    processingTimeMs: 42,
    cached: false,
})

const okResponse = (body: ConsensusReport) => ({
    ok: true,
    status: 200,
    json: async () => body,
})

const cacheKeyFor = (proposalId: number, analysisType = "dao") =>
    `memba_analyst_${NETWORK}_${REALM}_${proposalId}_${analysisType}`

const fetchMock = vi.fn()

/** Flush the queueMicrotask kickoff + the fetch promise chain. */
const flush = () => act(async () => { await Promise.resolve() })

describe("useAnalystReport", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", fetchMock)
        fetchMock.mockReset()
        sessionStorage.clear()
        localStorage.setItem("memba_auth_token", "test-token")
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    const renderDao = (initialProposalId = 1) =>
        renderHook(
            ({ proposalId }) =>
                useAnalystReport(REALM, proposalId, "proposal body", "dao ctx", "dao", NETWORK),
            { initialProps: { proposalId: initialProposalId } },
        )

    it("auto-fetches for dao analysis and caches the report in sessionStorage", async () => {
        const reportA = makeReport("report A")
        fetchMock.mockResolvedValue(okResponse(reportA))

        const { result } = renderDao(1)

        await waitFor(() => expect(result.current.report).toEqual(reportA))
        expect(result.current.loading).toBe(false)
        expect(result.current.error).toBeNull()
        expect(fetchMock).toHaveBeenCalledTimes(1)

        const [url, init] = fetchMock.mock.calls[0]
        expect(String(url)).not.toContain("force=1")
        expect(JSON.parse(init.body)).toMatchObject({
            realmPath: REALM,
            proposalId: 1,
            analysisType: "dao",
            chainId: NETWORK,
        })
        expect(init.headers.Authorization).toBe("Bearer test-token")

        // Session cache written for this context key
        expect(JSON.parse(sessionStorage.getItem(cacheKeyFor(1))!)).toEqual(reportA)
    })

    it("does not fetch when there is no auth token", async () => {
        localStorage.removeItem("memba_auth_token")
        const { result } = renderDao(1)

        await flush()
        await flush()

        expect(fetchMock).not.toHaveBeenCalled()
        expect(result.current.loading).toBe(false)
        expect(result.current.report).toBeNull()
    })

    it("resets report/error synchronously when the context changes (stale report never shown)", async () => {
        const reportA = makeReport("report A")
        const reportB = makeReport("report B")
        fetchMock.mockResolvedValueOnce(okResponse(reportA))

        const { result, rerender } = renderDao(1)
        await waitFor(() => expect(result.current.report).toEqual(reportA))

        // Switch to proposal 2 — with the during-render reset, the very first
        // committed render for the new key must NOT show proposal 1's report.
        // (Previously the effect-based reset allowed one stale render; the new
        // pattern is one render earlier — strictly better.)
        fetchMock.mockResolvedValueOnce(okResponse(reportB))
        rerender({ proposalId: 2 })

        expect(result.current.report).toBeNull()
        expect(result.current.error).toBeNull()

        // Auto-fetch then runs for the new key
        await waitFor(() => expect(result.current.report).toEqual(reportB))
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(JSON.parse(fetchMock.mock.calls[1][1].body).proposalId).toBe(2)
    })

    it("rehydrates from sessionStorage on context change without refetching", async () => {
        const reportA = makeReport("report A")
        const cached = makeReport("cached for proposal 2")
        fetchMock.mockResolvedValue(okResponse(reportA))

        const { result, rerender } = renderDao(1)
        await waitFor(() => expect(result.current.report).toEqual(reportA))
        expect(fetchMock).toHaveBeenCalledTimes(1)

        sessionStorage.setItem(cacheKeyFor(2), JSON.stringify(cached))
        rerender({ proposalId: 2 })

        // Rehydrated synchronously on the first render for the new key
        expect(result.current.report).toEqual(cached)
        expect(result.current.loading).toBe(false)

        await flush()
        await flush()
        // No network fetch for the cached context
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it("trigger() forces a refetch with ?force=1", async () => {
        const reportA = makeReport("report A")
        const reportA2 = makeReport("report A refreshed")
        fetchMock.mockResolvedValueOnce(okResponse(reportA))

        const { result } = renderDao(1)
        await waitFor(() => expect(result.current.report).toEqual(reportA))

        fetchMock.mockResolvedValueOnce(okResponse(reportA2))
        act(() => { result.current.trigger() })

        await waitFor(() => expect(result.current.report).toEqual(reportA2))
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(String(fetchMock.mock.calls[1][0])).toContain("force=1")
    })

    it("proposal analysis never auto-fetches; trigger() fetches on demand", async () => {
        const reportP = makeReport("proposal report")
        fetchMock.mockResolvedValue(okResponse(reportP))

        const { result } = renderHook(() =>
            useAnalystReport(REALM, 7, "proposal body", "", "proposal", NETWORK),
        )

        await flush()
        await flush()
        expect(fetchMock).not.toHaveBeenCalled()

        act(() => { result.current.trigger() })
        await waitFor(() => expect(result.current.report).toEqual(reportP))
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it("surfaces backend errors from a failed fetch", async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 503,
            json: async () => ({ error: "Analysis unavailable" }),
        })

        const { result } = renderDao(1)
        await waitFor(() => expect(result.current.error).toBe("Analysis unavailable"))
        expect(result.current.report).toBeNull()
        expect(result.current.loading).toBe(false)
    })
})
