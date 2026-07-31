import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom"
import { LegacyRedirect } from "./LegacyRedirect"
import { NETWORKS, DEFAULT_NETWORK, resolveStoredNetworkKey } from "../../lib/config"

/**
 * LegacyRedirect is the FOURTH copy of "which network does a stored key resolve
 * to". NetworkGate routes every legacy / bookmarked URL through it (any /:network
 * segment that isn't a known key lands here), so when it inlined its own
 * `(stored && NETWORKS[stored]) ? stored : DEFAULT_NETWORK` — with no `hidden`
 * check — `/` healed to `/topaz/` while `/directory` still went to
 * `/gnoland1/directory`. Bookmarks stayed pinned to a network the switcher no
 * longer offers.
 *
 * These assert against `resolveStoredNetworkKey` rather than a literal network so
 * they hold under any VITE_GNO_CHAIN_ID (the repo-root .env is untracked and pins
 * test13 on dev machines).
 */
function Landed() {
    const { pathname, search, hash } = useLocation()
    return <div data-testid="landed">{`${pathname}${search}${hash}`}</div>
}

/** Mirrors App.tsx: a legacy path falls through to LegacyRedirect; a
 *  network-prefixed one renders. */
function renderLegacy(entry: string) {
    cleanup() // several cases render in one test; keep getByTestId unambiguous
    render(
        <MemoryRouter initialEntries={[entry]}>
            <Routes>
                {Object.keys(NETWORKS).map(key => (
                    <Route key={key} path={`/${key}/*`} element={<Landed />} />
                ))}
                <Route path="*" element={<LegacyRedirect />} />
            </Routes>
        </MemoryRouter>,
    )
    return screen.getByTestId("landed").textContent ?? ""
}

const networkOf = (path: string) => path.match(/^\/([^/]+)\//)?.[1]

describe("LegacyRedirect — bookmarks must heal like / does", () => {
    afterEach(() => localStorage.removeItem("memba_network"))

    it("does NOT pin a bookmark to Betanet", () => {
        localStorage.setItem("memba_network", "gnoland1")
        const landed = renderLegacy("/directory")
        // The regression, stated directly: this used to be /gnoland1/directory.
        expect(networkOf(landed)).not.toBe("gnoland1")
        // Deliberately NOT asserting the result is visible: in a build that pins a
        // hidden network as the default (.env.e2e → test13) it legitimately is
        // not. That property is asserted hermetically for the shipped-build case
        // in config.test.ts; here the point is that the rule is SHARED, below.
    })

    it("uses the SAME rule as RootRedirect for every stored value", () => {
        // The actual invariant — one rule, not four drifting copies.
        for (const stored of ["gnoland1", "test13", "topaz", "no-such-network"]) {
            localStorage.setItem("memba_network", stored)
            const landed = renderLegacy("/directory")
            expect(networkOf(landed), `stored=${stored}`).toBe(resolveStoredNetworkKey(stored))
            localStorage.removeItem("memba_network")
        }
    })

    it("keeps a stored VISIBLE network", () => {
        localStorage.setItem("memba_network", "topaz")
        expect(renderLegacy("/directory")).toBe("/topaz/directory")
    })

    it("falls back to the default when nothing is stored", () => {
        expect(networkOf(renderLegacy("/directory"))).toBe(DEFAULT_NETWORK)
    })

    it("preserves path, search and hash", () => {
        localStorage.setItem("memba_network", "topaz")
        expect(renderLegacy("/dao/gno.land~r~gov~dao?tab=votes#top"))
            .toBe("/topaz/dao/gno.land~r~gov~dao?tab=votes#top")
    })
})
