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
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

const checkChainHealth = vi.fn()
vi.mock("../../lib/chainHealth", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/chainHealth")>()),
    checkChainHealth: (key: string, timeout?: number) => checkChainHealth(key, timeout),
}))

const { ChainHaltedBanner } = await import("./ChainHaltedBanner")

const reachable = { reachable: true, respondingRpc: "x", latencyMs: 1, chainId: "test-13", blockHeight: 1 }
const unreachable = { reachable: false, respondingRpc: null, latencyMs: null, chainId: "test-13", blockHeight: 0 }

beforeEach(() => checkChainHealth.mockReset())

describe("ChainHaltedBanner — test13 is not exempt", () => {
    it("probes test13 and shows the banner when every endpoint is unreachable", async () => {
        checkChainHealth.mockResolvedValue(unreachable)
        render(<ChainHaltedBanner networkKey="test13" onSwitchNetwork={() => {}} />)

        // The probe must actually run for test13 (it used to be skipped).
        await waitFor(() => expect(checkChainHealth).toHaveBeenCalledWith("test13", expect.any(Number)))
        expect(await screen.findByRole("alert")).toHaveTextContent(/unreachable/i)
    })

    it("does NOT show the banner when test13 is reachable (probe respects failover)", async () => {
        checkChainHealth.mockResolvedValue(reachable)
        render(<ChainHaltedBanner networkKey="test13" onSwitchNetwork={() => {}} />)

        await waitFor(() => expect(checkChainHealth).toHaveBeenCalled())
        // Give any state flush a tick; the banner must stay absent.
        await new Promise((r) => setTimeout(r, 0))
        expect(screen.queryByRole("alert")).toBeNull()
    })
})

describe("ChainHaltedBanner — fallback suggestion", () => {
    it("suggests Topaz (Memba realms live) for a down test13, never Betanet", async () => {
        checkChainHealth.mockResolvedValue(unreachable)
        render(<ChainHaltedBanner networkKey="test13" onSwitchNetwork={() => {}} />)

        const alert = await screen.findByRole("alert")
        // Topaz has Memba's core realms; Betanet/gnoland1 does not — never steer there.
        expect(alert).toHaveTextContent(/topaz/i)
        expect(alert).not.toHaveTextContent(/betanet/i)
    })
})
