import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom"
import { LegacyRedirect } from "./LegacyRedirect"
import { RootRedirect } from "./RootRedirect"
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

/** The other half of the shared rule: App.tsx's `/` → `/:network/`. */
function renderRoot() {
    cleanup()
    render(
        <MemoryRouter initialEntries={["/"]}>
            <Routes>
                {Object.keys(NETWORKS).map(key => (
                    <Route key={key} path={`/${key}/*`} element={<Landed />} />
                ))}
                <Route path="/" element={<RootRedirect />} />
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

    it("lands on the SAME network as RootRedirect for every stored value", () => {
        // The actual invariant — ONE rule, not several drifting copies. This
        // renders BOTH redirects and compares them to each other: the bug was
        // that `/` and `/directory` disagreed, which no single-component test
        // can see. (Comparing only against `resolveStoredNetworkKey` would
        // co-drift with it — the two sides must be the two real components.)
        for (const stored of ["gnoland1", "test13", "topaz", "no-such-network"]) {
            localStorage.setItem("memba_network", stored)
            const viaLegacy = networkOf(renderLegacy("/directory"))
            const viaRoot = networkOf(renderRoot())
            expect(viaLegacy, `stored=${stored}: / and /directory must agree`).toBe(viaRoot)
            expect(viaLegacy, `stored=${stored}`).toBe(resolveStoredNetworkKey(stored))
            localStorage.removeItem("memba_network")
        }
    })

    it("RootRedirect itself does not restore Betanet", () => {
        localStorage.setItem("memba_network", "gnoland1")
        expect(networkOf(renderRoot())).not.toBe("gnoland1")
    })

    it("keeps a stored VISIBLE network", () => {
        localStorage.setItem("memba_network", "sapphire")
        expect(renderLegacy("/directory")).toBe("/sapphire/directory")
    })

    it("falls back to the default when nothing is stored", () => {
        expect(networkOf(renderLegacy("/directory"))).toBe(DEFAULT_NETWORK)
    })

    it("preserves path, search and hash", () => {
        localStorage.setItem("memba_network", "sapphire")
        expect(renderLegacy("/dao/gno.land~r~gov~dao?tab=votes#top"))
            .toBe("/sapphire/dao/gno.land~r~gov~dao?tab=votes#top")
    })
})
