import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { MemoryRouter, Routes, Route } from "react-router-dom"
import { useNetworkKey } from "./useNetworkNav"
import { DEFAULT_NETWORK, NETWORKS } from "../lib/config"

function Probe() {
    return <div data-testid="key">{useNetworkKey()}</div>
}

/** Outside a /:network route the hook falls back to storage. It must follow
 *  the redirects' rule (storedNetworkKey) — never the raw URL echo, which can
 *  name a hidden or retired network the redirects would never land on. */
function keyAt(entry: string) {
    cleanup()
    render(
        <MemoryRouter initialEntries={[entry]}>
            <Routes>
                <Route path="/:network/*" element={<Probe />} />
                <Route path="*" element={<Probe />} />
            </Routes>
        </MemoryRouter>,
    )
    return screen.getByTestId("key").textContent
}

describe("useNetworkKey", () => {
    afterEach(() => localStorage.clear())

    it("uses the /:network param when it names a network", () => {
        expect(keyAt("/test13/directory")).toBe("test13")
        expect(keyAt("/mainnet/")).toBe("mainnet")
    })

    it("never takes an Object.prototype member in the URL for a network", () => {
        for (const segment of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
            expect(keyAt(`/${segment}/directory`), segment).toBe(DEFAULT_NETWORK)
        }
    })

    it("ignores a stale URL echo naming a retired or hidden network", () => {
        for (const echo of ["test13"]) {
            expect(NETWORKS[echo]?.hidden, echo).toBe(true)
            localStorage.setItem("memba_network", echo)
            expect(keyAt("/no-network-here"), echo).toBe(DEFAULT_NETWORK)
        }
        // …and one that has left the registry altogether.
        for (const echo of ["pearl", "topaz", "sapphire", "gnoland1"]) {
            expect(NETWORKS[echo], echo).toBeUndefined()
            localStorage.setItem("memba_network", echo)
            expect(keyAt("/no-network-here"), echo).toBe(DEFAULT_NETWORK)
        }
    })

    it("ignores a stored explicit choice of a hidden network, and honours a visible one", () => {
        localStorage.setItem("memba_network_pref", "test13")
        expect(keyAt("/no-network-here")).toBe(DEFAULT_NETWORK)
        // A retired network (pearl) is no network at all.
        localStorage.setItem("memba_network_pref", "pearl")
        expect(keyAt("/no-network-here")).toBe(DEFAULT_NETWORK)
        localStorage.setItem("memba_network_pref", "mainnet")
        expect(keyAt("/no-network-here")).toBe("mainnet")
    })
})
