import { describe, it, expect, afterEach, vi } from "vitest"
import { resolveNetworkKey, DEFAULT_NETWORK, NETWORKS } from "./config"

/**
 * Which network the app initialises on, and where `/` or a legacy path sends you.
 *
 * TWO storage keys, because one key cannot be both things it was asked to be:
 *  - `memba_network` is an ECHO. NetworkSync rewrites it on every `/:network/*`
 *    visit, so anyone who ever opened a `/pearl/...` link has "pearl" there
 *    without having chosen anything.
 *  - `memba_network_pref` is written ONLY by an explicit switch.
 * Keeping a real choice apart from the echo is what lets a change of default
 * network move the people who never chose, and leave alone the ones who did.
 *
 * And the URL comes FIRST at module load. config.ts computes every RPC and realm
 * constant before the router mounts; reading storage alone meant a deep link to
 * another network loaded the wrong config, and NetworkSync then reloaded the
 * whole page to correct it.
 */

// Fixture networks, by the visibility config.test.ts already pins:
// pearl, gnoland1 visible; test13, sapphire hidden.
const VISIBLE_A = "pearl"
const VISIBLE_B = "gnoland1"
const HIDDEN = "sapphire"
const HIDDEN_DEEP_LINK = "test13"

describe("resolveNetworkKey — the one ordering rule", () => {
    it("fixtures are what they claim to be", () => {
        expect(NETWORKS[VISIBLE_A]?.hidden).toBeFalsy()
        expect(NETWORKS[VISIBLE_B]?.hidden).toBeFalsy()
        expect(NETWORKS[HIDDEN]?.hidden).toBe(true)
        expect(NETWORKS[HIDDEN_DEEP_LINK]?.hidden).toBe(true)
    })

    it("the network in the URL wins over anything stored", () => {
        expect(resolveNetworkKey({ pathname: `/${VISIBLE_B}/validators`, pref: VISIBLE_A, echo: VISIBLE_A })).toBe(VISIBLE_B)
    })

    it("a URL may name a hidden network — deep links keep working", () => {
        expect(resolveNetworkKey({ pathname: `/${HIDDEN_DEEP_LINK}/create-token` })).toBe(HIDDEN_DEEP_LINK)
    })

    it("a first path segment that is not a network is ignored", () => {
        expect(resolveNetworkKey({ pathname: "/directory" })).toBe(DEFAULT_NETWORK)
        expect(resolveNetworkKey({ pathname: "/no-such-network/x", echo: VISIBLE_B })).toBe(VISIBLE_B)
    })

    it("an explicit choice outranks the URL echo", () => {
        expect(resolveNetworkKey({ pathname: "/", pref: VISIBLE_B, echo: VISIBLE_A })).toBe(VISIBLE_B)
    })

    it("the echo still answers when nothing was chosen", () => {
        expect(resolveNetworkKey({ pathname: "/", echo: VISIBLE_B })).toBe(VISIBLE_B)
    })

    it("a stored key never restores a hidden network — neither the choice nor the echo", () => {
        expect(resolveNetworkKey({ pref: HIDDEN, echo: VISIBLE_B })).toBe(VISIBLE_B)
        expect(resolveNetworkKey({ pref: HIDDEN, echo: HIDDEN_DEEP_LINK })).toBe(DEFAULT_NETWORK)
    })

    it("unknown stored values and an empty store fall back to the default", () => {
        expect(resolveNetworkKey({ pref: "no-such-network" })).toBe(DEFAULT_NETWORK)
        expect(resolveNetworkKey({})).toBe(DEFAULT_NETWORK)
    })
})

describe("ACTIVE_NETWORK_KEY — what config.ts initialises with", () => {
    afterEach(() => {
        localStorage.clear()
        window.history.replaceState({}, "", "/")
        vi.resetModules()
    })

    // config.ts resolves once, at module evaluation: re-evaluate it for each case.
    async function loadAt(pathname: string, stored: { pref?: string; echo?: string } = {}) {
        vi.resetModules()
        window.history.replaceState({}, "", pathname)
        if (stored.pref) localStorage.setItem("memba_network_pref", stored.pref)
        if (stored.echo) localStorage.setItem("memba_network", stored.echo)
        return (await import("./config")).ACTIVE_NETWORK_KEY
    }

    it("a deep link loads the linked network's config, whatever the echo says", async () => {
        // Before: storage alone decided, so this loaded pearl's RPC and realm
        // constants and NetworkSync then reloaded the page onto gnoland1.
        expect(await loadAt(`/${VISIBLE_B}/validators`, { echo: VISIBLE_A })).toBe(VISIBLE_B)
    })

    it("a deep link to a hidden network still loads that network", async () => {
        expect(await loadAt(`/${HIDDEN_DEEP_LINK}/create-token`)).toBe(HIDDEN_DEEP_LINK)
    })

    it("on `/`, an explicit choice outranks the echo", async () => {
        expect(await loadAt("/", { pref: VISIBLE_B, echo: VISIBLE_A })).toBe(VISIBLE_B)
    })

    it("on a legacy path with a hidden echo, loads what LegacyRedirect will send you to", async () => {
        // Before: this loaded the hidden network, LegacyRedirect healed to the
        // default, and the mismatch cost a full reload.
        expect(await loadAt("/directory", { echo: HIDDEN })).toBe(DEFAULT_NETWORK)
    })
})
