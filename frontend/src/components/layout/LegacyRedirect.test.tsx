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

    it("keeps a Betanet bookmark now that gnoland1 is visible again (2026-08-27)", () => {
        // The old regression was pinning bookmarks to a HIDDEN network; the
        // rule under test is "stored keys heal off hidden networks only".
        // gnoland1 left the hidden set, so a stored selection legitimately
        // sticks — the hidden-healing property stays covered by the
        // every-stored-value sweep below (test13/topaz).
        localStorage.setItem("memba_network", "gnoland1")
        const landed = renderLegacy("/directory")
        expect(networkOf(landed)).toBe("gnoland1")
    })

    it("lands on the SAME network as RootRedirect for every stored value", () => {
        // The actual invariant — ONE rule, not several drifting copies. This
        // renders BOTH redirects and compares them to each other: the bug was
        // that `/` and `/directory` disagreed, which no single-component test
        // can see. (Comparing only against `resolveStoredNetworkKey` would
        // co-drift with it — the two sides must be the two real components.)
        for (const stored of ["gnoland1", "test13", "topaz", "sapphire", "no-such-network"]) {
            localStorage.setItem("memba_network", stored)
            const viaLegacy = networkOf(renderLegacy("/directory"))
            const viaRoot = networkOf(renderRoot())
            expect(viaLegacy, `stored=${stored}: / and /directory must agree`).toBe(viaRoot)
            expect(viaLegacy, `stored=${stored}`).toBe(resolveStoredNetworkKey(stored))
            localStorage.removeItem("memba_network")
        }
    })

    it("RootRedirect restores a stored Betanet selection (visible again)", () => {
        localStorage.setItem("memba_network", "gnoland1")
        expect(networkOf(renderRoot())).toBe("gnoland1")
    })

    it("keeps a stored VISIBLE network", () => {
        localStorage.setItem("memba_network", "pearl")
        expect(renderLegacy("/directory")).toBe("/pearl/directory")
    })

    it("heals a stored sapphire selection off the sunset network (2026-09-09)", () => {
        // Sapphire joined the hidden set at its sunset: a returning pre-sunset
        // user's bookmark must land on a network the switcher actually offers.
        localStorage.setItem("memba_network", "sapphire")
        expect(networkOf(renderLegacy("/directory"))).toBe(resolveStoredNetworkKey("sapphire"))
        expect(networkOf(renderLegacy("/directory"))).not.toBe("sapphire")
    })

    it("falls back to the default when nothing is stored", () => {
        expect(networkOf(renderLegacy("/directory"))).toBe(DEFAULT_NETWORK)
    })

    it("preserves path, search and hash", () => {
        localStorage.setItem("memba_network", "pearl")
        expect(renderLegacy("/dao/gno.land~r~gov~dao?tab=votes#top"))
            .toBe("/pearl/dao/gno.land~r~gov~dao?tab=votes#top")
    })
})
