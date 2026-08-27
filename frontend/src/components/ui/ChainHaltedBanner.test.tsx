/**
 * ChainHaltedBanner — the unreachable-network warning must fire for test13 too.
 *
 * The banner used to hardcode-skip test13 ("known-good"), so if every test13
 * RPC became unreachable for a user, the app broke with no explanation. The
 * health probe already races primary + all fallbacks (chainHealth.checkChainHealth),
 * so the banner only appears when the network is genuinely unreachable — the
 * exemption suppressed a real, useful signal.
 *
 * checkChainHealth (the network probe) is mocked; getSuggestedFallback stays
 * REAL so the fallback-ordering fix (prefer topaz over Betanet) is exercised.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render as rtlRender, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"

// Fresh client per render: retry off and zero cache sharing between tests —
// a cached "healthy" verdict from one test must never leak into the next.
function render(ui: ReactElement) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const checkChainHealth = vi.fn()
vi.mock("../../lib/chainHealth", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/chainHealth")>()),
    checkChainHealth: (key: string, timeout?: number) => checkChainHealth(key, timeout),
}))

const { ChainHaltedBanner, PROBE_RETRY_DELAY_MS } = await import("./ChainHaltedBanner")

const reachable = { reachable: true, respondingRpc: "x", latencyMs: 1, chainId: "test-13", blockHeight: 1 }
const unreachable = { reachable: false, respondingRpc: null, latencyMs: null, chainId: "test-13", blockHeight: 0 }

// Fake timers so the two-strikes retry delay doesn't make the suite wait in
// real time. shouldAdvanceTime lets testing-library's async utilities still run.
beforeEach(() => {
    checkChainHealth.mockReset()
    vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => vi.useRealTimers())

/** Drive both probes of the two-strikes cycle to completion. */
async function settleTwoStrikes() {
    await waitFor(() => expect(checkChainHealth).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(PROBE_RETRY_DELAY_MS)
}

describe("ChainHaltedBanner — test13 is not exempt", () => {
    it("probes test13 and shows the banner when every endpoint is unreachable (twice)", async () => {
        checkChainHealth.mockResolvedValue(unreachable)
        render(<ChainHaltedBanner networkKey="test13" onSwitchNetwork={() => {}} />)

        // The probe must actually run for test13 (it used to be skipped).
        await settleTwoStrikes()
        await waitFor(() => expect(checkChainHealth).toHaveBeenCalledTimes(2))
        expect(await screen.findByRole("alert")).toHaveTextContent(/unreachable/i)
    })

    it("does NOT show the banner when test13 is reachable (probe respects failover)", async () => {
        checkChainHealth.mockResolvedValue(reachable)
        render(<ChainHaltedBanner networkKey="test13" onSwitchNetwork={() => {}} />)

        await waitFor(() => expect(checkChainHealth).toHaveBeenCalled())
        await vi.advanceTimersByTimeAsync(0)
        // A reachable first probe means no retry and no banner.
        expect(checkChainHealth).toHaveBeenCalledTimes(1)
        expect(screen.queryByRole("alert")).toBeNull()
    })

    it("does NOT latch the banner on a one-off blip (fail then recover)", async () => {
        // First probe fails, the confirming re-probe succeeds → transient, no banner.
        checkChainHealth.mockResolvedValueOnce(unreachable).mockResolvedValueOnce(reachable)
        render(<ChainHaltedBanner networkKey="test13" onSwitchNetwork={() => {}} />)

        await settleTwoStrikes()
        await waitFor(() => expect(checkChainHealth).toHaveBeenCalledTimes(2))
        await vi.advanceTimersByTimeAsync(0)
        expect(screen.queryByRole("alert")).toBeNull()
    })
})

describe("ChainHaltedBanner — fallback suggestion", () => {
    it("suggests Sapphire (Memba realms live) for a down test13, never Betanet", async () => {
        checkChainHealth.mockResolvedValue(unreachable)
        render(<ChainHaltedBanner networkKey="test13" onSwitchNetwork={() => {}} />)

        await settleTwoStrikes()
        const alert = await screen.findByRole("alert")
        // Topaz has Memba's core realms; Betanet/gnoland1 does not — never steer there.
        expect(alert).toHaveTextContent(/sapphire/i)
        expect(alert).not.toHaveTextContent(/betanet/i)
    })
})
