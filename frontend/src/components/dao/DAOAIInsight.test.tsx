/**
 * DAOAIInsight.test.tsx — VITE_ENABLE_ANALYST must be a real gate.
 *
 * The DAO-level report auto-fetches on mount, so hiding the UI is not enough:
 * with the flag off no analyst request may leave the browser. With the flag on,
 * the existing auto-fetch behavior is preserved.
 *
 * ANALYST_ENABLED is read at module load, so each case stubs the env, resets the
 * module registry and imports the component fresh.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, act, waitFor } from "@testing-library/react"

vi.mock("../../hooks/useNetworkNav", () => ({
    useNetworkKey: () => "pearl",
}))

const REALM = "gno.land/r/samcrew/memba_dao"
const fetchMock = vi.fn()

const report = {
    consensus: {
        verdict: "approve",
        confidence: 0.9,
        agreementLevel: "unanimous",
        agreeCount: 1,
        respondedCount: 1,
        totalCount: 1,
        summary: "ok",
        keyRisks: [],
        keyRecommendations: [],
    },
    perspectives: [],
    processingTimeMs: 1,
    cached: true,
}

async function renderInsight() {
    vi.resetModules()
    const { DAOAIInsight } = await import("./DAOAIInsight")
    return render(<DAOAIInsight realmPath={REALM} daoSummary="3 members, 12 proposals" />)
}

/** Flush the hook's queueMicrotask kickoff and any resulting promise chain. */
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

describe("DAOAIInsight analyst flag gate", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", fetchMock)
        fetchMock.mockReset()
        fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => report })
        sessionStorage.clear()
        localStorage.setItem("memba_auth_token", "test-token")
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.unstubAllEnvs()
        localStorage.removeItem("memba_auth_token")
    })

    it("sends no analyst request when VITE_ENABLE_ANALYST is off", async () => {
        vi.stubEnv("VITE_ENABLE_ANALYST", "false")
        const { container } = await renderInsight()

        await flush()
        await flush()

        expect(fetchMock).not.toHaveBeenCalled()
        expect(container).toBeEmptyDOMElement()
    })

    it("still auto-fetches the DAO report when VITE_ENABLE_ANALYST is on", async () => {
        vi.stubEnv("VITE_ENABLE_ANALYST", "true")
        const { container } = await renderInsight()

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
        const [url, init] = fetchMock.mock.calls[0]
        expect(String(url)).toContain("/api/analyst/consensus")
        expect(JSON.parse(init.body)).toMatchObject({ realmPath: REALM, analysisType: "dao", chainId: "pearl" })
        await waitFor(() => expect(container).not.toBeEmptyDOMElement())
    })
})
