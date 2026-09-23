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

/** Since pearl's 2026-09-23 retirement mainnet is the ONLY visible network, so
 *  a case that needs a visible NON-default network un-hides pearl for its
 *  duration (the resolver reads `hidden` at call time). Without a second
 *  visible network such a case could not tell "kept the stored key" from
 *  "fell back to the default". */
function withPearlVisible(fn: () => void) {
    const was = NETWORKS.pearl.hidden
    NETWORKS.pearl.hidden = false
    try {
        fn()
    } finally {
        NETWORKS.pearl.hidden = was
    }
}

describe("LegacyRedirect — bookmarks must heal like / does", () => {
    // Stored values are written to the EXPLICIT-choice key: since 2026-09-23 it
    // is the only storage the redirects read (the URL echo was dropped).
    afterEach(() => localStorage.removeItem("memba_network_pref"))

    it("heals a Betanet bookmark away now that gnoland1 is hidden again (2026-09-17)", () => {
        // The rule under test is "stored keys heal off hidden networks only".
        // gnoland1 was visible 2026-08-27 → 2026-09-17 and a stored selection
        // legitimately stuck; it is retired to hidden again (every public
        // Betanet endpoint dead), so the healing side is what this asserts.
        // A stored key that stayed VISIBLE is covered by "keeps a stored
        // VISIBLE network" below.
        localStorage.setItem("memba_network_pref", "gnoland1")
        const landed = renderLegacy("/directory")
        expect(networkOf(landed)).toBe(DEFAULT_NETWORK)
    })

    it("lands on the SAME network as RootRedirect for every stored value", () => {
        // The actual invariant — ONE rule, not several drifting copies. This
        // renders BOTH redirects and compares them to each other: the bug was
        // that `/` and `/directory` disagreed, which no single-component test
        // can see. (Comparing only against `resolveStoredNetworkKey` would
        // co-drift with it — the two sides must be the two real components.)
        for (const stored of ["gnoland1", "test13", "topaz", "sapphire", "pearl", "no-such-network"]) {
            localStorage.setItem("memba_network_pref", stored)
            const viaLegacy = networkOf(renderLegacy("/directory"))
            const viaRoot = networkOf(renderRoot())
            expect(viaLegacy, `stored=${stored}: / and /directory must agree`).toBe(viaRoot)
            expect(viaLegacy, `stored=${stored}`).toBe(resolveStoredNetworkKey(stored))
            localStorage.removeItem("memba_network_pref")
        }
    })

    it("RootRedirect heals a stored Betanet selection away (hidden again)", () => {
        localStorage.setItem("memba_network_pref", "gnoland1")
        expect(networkOf(renderRoot())).toBe(DEFAULT_NETWORK)
    })

    it("keeps a stored VISIBLE network", () => {
        withPearlVisible(() => {
            localStorage.setItem("memba_network_pref", "pearl")
            expect(renderLegacy("/directory")).toBe("/pearl/directory")
        })
    })

    it("heals a stored pearl selection off the retired network (2026-09-23)", () => {
        localStorage.setItem("memba_network_pref", "pearl")
        expect(networkOf(renderLegacy("/directory"))).toBe(resolveStoredNetworkKey("pearl"))
        expect(networkOf(renderLegacy("/directory"))).not.toBe("pearl")
    })

    it("heals a stored sapphire selection off the sunset network (2026-09-09)", () => {
        // Sapphire joined the hidden set at its sunset: a returning pre-sunset
        // user's bookmark must land on a network the switcher actually offers.
        localStorage.setItem("memba_network_pref", "sapphire")
        expect(networkOf(renderLegacy("/directory"))).toBe(resolveStoredNetworkKey("sapphire"))
        expect(networkOf(renderLegacy("/directory"))).not.toBe("sapphire")
    })

    it("falls back to the default when nothing is stored", () => {
        expect(networkOf(renderLegacy("/directory"))).toBe(DEFAULT_NETWORK)
    })

    it("preserves path, search and hash", () => {
        withPearlVisible(() => {
            localStorage.setItem("memba_network_pref", "pearl")
            expect(renderLegacy("/dao/gno.land~r~gov~dao?tab=votes#top"))
                .toBe("/pearl/dao/gno.land~r~gov~dao?tab=votes#top")
        })
    })
})

/**
 * `memba_network` is an echo of the last /:network URL visited (NetworkSync);
 * `memba_network_pref` is written only when the user explicitly switches. A
 * visit to a /pearl/... link must not count as choosing pearl — otherwise a
 * change of default network could never move anyone. Since pearl's retirement
 * (2026-09-23) the echo is not read by the redirects at all.
 */
describe("Redirects — only an explicit choice is restored, never the URL echo", () => {
    afterEach(() => {
        localStorage.removeItem("memba_network")
        localStorage.removeItem("memba_network_pref")
    })

    it("sends / and a bookmark to the chosen network, not the last one visited", () => {
        // Both values must name VISIBLE networks or the case proves nothing.
        // Pearl is hidden since 2026-09-23, so it is un-hidden for the case.
        withPearlVisible(() => {
            localStorage.setItem("memba_network", "mainnet")
            localStorage.setItem("memba_network_pref", "pearl")
            expect(networkOf(renderRoot())).toBe("pearl")
            expect(networkOf(renderLegacy("/directory"))).toBe("pearl")
        })
    })

    it("a stale echo no longer steers / or a bookmark, even to a visible network", () => {
        // Every pre-retirement visitor carries `memba_network=pearl`. With the
        // echo step dropped they land on the default, whatever the echo says.
        withPearlVisible(() => {
            localStorage.setItem("memba_network", "pearl")
            expect(networkOf(renderRoot())).toBe(DEFAULT_NETWORK)
            expect(networkOf(renderLegacy("/directory"))).toBe(DEFAULT_NETWORK)
        })
        localStorage.setItem("memba_network", "pearl")
        expect(networkOf(renderRoot())).toBe(DEFAULT_NETWORK)
        expect(networkOf(renderLegacy("/directory"))).toBe(DEFAULT_NETWORK)
    })

    it("never restores a chosen network that has since been hidden — and does not fall back to the echo", () => {
        withPearlVisible(() => {
            localStorage.setItem("memba_network", "pearl")
            localStorage.setItem("memba_network_pref", "sapphire")
            expect(networkOf(renderRoot())).toBe(DEFAULT_NETWORK)
            expect(networkOf(renderLegacy("/directory"))).toBe(DEFAULT_NETWORK)
        })
    })

    it("a stored pearl choice (retired) lands on the default", () => {
        localStorage.setItem("memba_network_pref", "pearl")
        expect(networkOf(renderRoot())).toBe(DEFAULT_NETWORK)
        expect(networkOf(renderLegacy("/directory"))).toBe(DEFAULT_NETWORK)
    })

    it("/ and a bookmark agree for every stored choice", () => {
        withPearlVisible(() => {
            for (const pref of ["gnoland1", "test13", "sapphire", "no-such-network"]) {
                localStorage.setItem("memba_network", "pearl")
                localStorage.setItem("memba_network_pref", pref)
                expect(networkOf(renderLegacy("/directory")), `pref=${pref}`).toBe(networkOf(renderRoot()))
            }
        })
        // …and with pearl hidden (reality since 2026-09-23) as well.
        for (const pref of ["gnoland1", "pearl", "no-such-network"]) {
            localStorage.setItem("memba_network", "pearl")
            localStorage.setItem("memba_network_pref", pref)
            expect(networkOf(renderLegacy("/directory")), `pref=${pref}`).toBe(networkOf(renderRoot()))
        }
    })
})
