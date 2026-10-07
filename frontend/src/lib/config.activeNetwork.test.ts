import { describe, it, expect, afterAll, afterEach, beforeAll, vi } from "vitest"
import {
    resolveNetworkKey, resolveDefaultNetwork, retiredNetworkSuccessor, currentNetworkKey, isNetworkKey, isRealmValidOn,
    networkHasAllowlistedRealms, DEFAULT_NETWORK, NETWORKS, RETIRED_NETWORKS,
} from "./config"

/**
 * Which network the app initialises on, and where `/` or a legacy path sends you.
 *
 * Only the EXPLICIT choice is read from storage:
 *  - `memba_network_pref` is written ONLY by an explicit switch.
 *  - `memba_network` is an ECHO. NetworkSync rewrites it on every `/:network/*`
 *    visit, so anyone who ever opened a `/pearl/...` link has "pearl" there
 *    without having chosen anything. It used to be a fallback step; it was
 *    dropped at pearl's retirement (2026-09-23) so the default moves everyone
 *    who never chose.
 *
 * And the URL comes FIRST at module load. config.ts computes every RPC and realm
 * constant before the router mounts; reading storage alone meant a deep link to
 * another network loaded the wrong config, and NetworkSync then reloaded the
 * whole page to correct it.
 */

// Fixture networks, by the visibility config.test.ts already pins: mainnet
// (the default since 2026-09-17) and onyx (offered since 2026-10-07, Connect 4)
// are the visible networks; test13 is hidden, and pearl has left the registry
// (RETIRED_NETWORKS only). VISIBLE_B was `gnoland1` until Betanet was retired.
// The pure-resolver block needs TWO visible networks to tell "the choice wins"
// apart from "the default answered"; it still un-hides onyx (as VISIBLE_A) for
// its duration, which is now a no-op kept so the block holds on its own.
const VISIBLE_A = "onyx"
const VISIBLE_B = "mainnet"
const HIDDEN = "test13"
const HIDDEN_DEEP_LINK = "test13"
const RETIRED = "pearl"

describe("resolveNetworkKey — a stored choice of a hidden network", () => {
    it("never restores a hidden network", () => {
        expect(NETWORKS[HIDDEN]?.hidden).toBe(true)
        expect(resolveNetworkKey({ pref: HIDDEN })).toBe(DEFAULT_NETWORK)
        expect(resolveNetworkKey({ pref: HIDDEN_DEEP_LINK })).toBe(DEFAULT_NETWORK)
    })
})

describe("resolveNetworkKey — the one ordering rule", () => {
    let wasHidden: boolean | undefined
    beforeAll(() => {
        wasHidden = NETWORKS[VISIBLE_A].hidden
        NETWORKS[VISIBLE_A].hidden = false
    })
    afterAll(() => {
        NETWORKS[VISIBLE_A].hidden = wasHidden
    })

    it("fixtures are what they claim to be", () => {
        expect(NETWORKS[VISIBLE_A]?.hidden).toBeFalsy()
        expect(NETWORKS[VISIBLE_B]?.hidden).toBeFalsy()
        expect(NETWORKS[HIDDEN_DEEP_LINK]?.hidden).toBe(true)
    })

    it("the network in the URL wins over anything stored", () => {
        expect(resolveNetworkKey({ pathname: `/${VISIBLE_B}/validators`, pref: VISIBLE_A })).toBe(VISIBLE_B)
    })

    it("a URL may name a hidden network — deep links keep working", () => {
        expect(resolveNetworkKey({ pathname: `/${HIDDEN_DEEP_LINK}/create-token` })).toBe(HIDDEN_DEEP_LINK)
    })

    it("a first path segment that is not a network is ignored", () => {
        expect(resolveNetworkKey({ pathname: "/directory" })).toBe(DEFAULT_NETWORK)
        expect(resolveNetworkKey({ pathname: "/no-such-network/x", pref: VISIBLE_A })).toBe(VISIBLE_A)
    })

    it("an explicit choice answers when the URL names no network", () => {
        expect(resolveNetworkKey({ pathname: "/", pref: VISIBLE_A })).toBe(VISIBLE_A)
    })

    it("the URL echo is no longer an input — nothing chosen means the default", () => {
        // `echo` is not part of the signature any more; a caller passing one
        // (as the pre-2026-09-23 resolver accepted) must not move the result.
        const withEcho = { pathname: "/", echo: VISIBLE_A } as Parameters<typeof resolveNetworkKey>[0]
        expect(resolveNetworkKey(withEcho)).toBe(DEFAULT_NETWORK)
    })

    it("a stored choice never restores a hidden network", () => {
        // The hidden case (test13) is also pinned in the block above.
        expect(resolveNetworkKey({ pref: HIDDEN_DEEP_LINK })).toBe(DEFAULT_NETWORK)
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
        vi.unstubAllEnvs()
        vi.resetModules()
    })

    // config.ts resolves once, at module evaluation: re-evaluate it for each case.
    // `echo` is still written for the cases that prove it is IGNORED.
    async function loadAt(pathname: string, stored: { pref?: string; echo?: string } = {}) {
        vi.resetModules()
        window.history.replaceState({}, "", pathname)
        if (stored.pref) localStorage.setItem("memba_network_pref", stored.pref)
        if (stored.echo) localStorage.setItem("memba_network", stored.echo)
        return (await import("./config")).ACTIVE_NETWORK_KEY
    }

    it("a deep link loads the linked network's config, whatever storage says", async () => {
        // Before: storage alone decided, so this loaded the stored network's
        // RPC and realm constants and NetworkSync then reloaded the page. The
        // stubbed default is a hidden network so "the default answered" cannot
        // pass; only the URL-first rule yields mainnet.
        vi.stubEnv("VITE_GNO_CHAIN_ID", HIDDEN_DEEP_LINK)
        expect(await loadAt(`/${VISIBLE_B}/validators`, { echo: HIDDEN })).toBe(VISIBLE_B)
    })

    it("a deep link to a RETIRED network loads its successor's config", async () => {
        // NetworkGate redirects /pearl/… to /mainnet/…; initialising on pearl
        // would load a dead chain's RPC and then cost a reload on arrival.
        expect(await loadAt(`/${RETIRED}/validators`)).toBe(retiredNetworkSuccessor(RETIRED))
        expect(await loadAt(`/${RETIRED}/validators`)).toBe("mainnet")
        // The same holds for a retired network with no registry entry. The
        // default is stubbed to a hidden network so only the redirect rule,
        // not "unknown key → default", can yield mainnet.
        vi.stubEnv("VITE_GNO_CHAIN_ID", HIDDEN_DEEP_LINK)
        expect(await loadAt("/topaz/validators")).toBe("mainnet")
        expect(await loadAt("/sapphire/dao/create")).toBe("mainnet")
    })

    it("a deep link to a hidden network still loads that network", async () => {
        expect(await loadAt(`/${HIDDEN_DEEP_LINK}/create-token`)).toBe(HIDDEN_DEEP_LINK)
    })

    it("on `/`, a stored explicit choice is honoured at module load", async () => {
        // With one visible network the pref-vs-echo RANKING cannot be observed
        // here (it is pinned on the pure resolver above). What this pins is the
        // wiring: config.ts reads the stored choice at load. The default is
        // stubbed to a hidden network so "the default answered" cannot pass.
        vi.stubEnv("VITE_GNO_CHAIN_ID", HIDDEN_DEEP_LINK)
        expect(await loadAt("/", { pref: VISIBLE_B, echo: HIDDEN })).toBe(VISIBLE_B)
    })

    it("on a legacy path with a hidden echo, loads what LegacyRedirect will send you to", async () => {
        // Before: this loaded the hidden network, LegacyRedirect healed to the
        // default, and the mismatch cost a full reload.
        expect(await loadAt("/directory", { echo: HIDDEN })).toBe(DEFAULT_NETWORK)
    })

    it("a stored RETIRED choice (pearl) loads the default, never the dead chain", async () => {
        expect(await loadAt("/", { pref: RETIRED, echo: RETIRED })).toBe(DEFAULT_NETWORK)
        expect(await loadAt("/directory", { pref: RETIRED })).toBe(DEFAULT_NETWORK)
    })

    it("a stored choice of a retired network with no registry entry loads the default", async () => {
        for (const key of ["topaz", "sapphire"]) {
            localStorage.clear()
            expect(await loadAt("/", { pref: key, echo: key }), key).toBe(DEFAULT_NETWORK)
            expect(await loadAt("/directory", { pref: key }), key).toBe(DEFAULT_NETWORK)
        }
    })
})

describe("retiredNetworkSuccessor — which networks redirect, and where", () => {
    it("pearl is retired to mainnet (owner ruling 2026-09-23)", () => {
        expect(RETIRED_NETWORKS.pearl).toEqual({ to: "mainnet", name: "Pearl testnet" })
        expect(retiredNetworkSuccessor("pearl")).toBe("mainnet")
    })

    it("pearl, topaz and sapphire are retired to mainnet, with no registry entry", () => {
        expect(RETIRED_NETWORKS.topaz).toEqual({ to: "mainnet", name: "Topaz testnet" })
        expect(RETIRED_NETWORKS.sapphire).toEqual({ to: "mainnet", name: "Sapphire testnet" })
        for (const key of ["pearl", "topaz", "sapphire"]) {
            expect(isNetworkKey(key), key).toBe(false)
            expect(NETWORKS[key], key).toBeUndefined()
            expect(retiredNetworkSuccessor(key), key).toBe("mainnet")
            expect(resolveNetworkKey({ pathname: `/${key}/x` }), key).toBe("mainnet")
            expect(resolveNetworkKey({ pathname: `/${key}` }), key).toBe("mainnet")
            // The URL wins over a stored choice, as for any network in the URL.
            expect(resolveNetworkKey({ pathname: `/${key}/x`, pref: "mainnet" }), key).toBe("mainnet")
            // Only a URL redirects: a stored key is just an unknown value.
            expect(resolveNetworkKey({ pref: key }), key).toBe(DEFAULT_NETWORK)
        }
    })

    it("a retired network needs no registry entry: its URL resolves to the successor, even one that is not the default", () => {
        // Pointed at onyx here: with the default as successor, a resolver that skipped
        // the retired step would reach the same answer by falling through to the default.
        const entry = RETIRED_NETWORKS.pearl
        const successor = entry.to
        entry.to = "onyx"
        try {
            expect(Object.hasOwn(NETWORKS, "pearl")).toBe(false)
            expect(DEFAULT_NETWORK).not.toBe("onyx")
            expect(retiredNetworkSuccessor("pearl")).toBe("onyx")
            expect(resolveNetworkKey({ pathname: "/pearl/dao/create" })).toBe("onyx")
        } finally {
            entry.to = successor
        }
    })

    it("a successor that is missing, not the registry's own key, or itself retired gives no redirect", () => {
        const entry = RETIRED_NETWORKS.pearl
        const successor = entry.to
        try {
            for (const bad of ["no-such-network", "constructor", "pearl", ""]) {
                entry.to = bad
                expect(retiredNetworkSuccessor("pearl"), bad).toBeNull()
            }
        } finally {
            entry.to = successor
        }
    })

    it("a name every object has is not a network: only the registry's own keys count", () => {
        for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
            expect(isNetworkKey(key), key).toBe(false)
            expect(retiredNetworkSuccessor(key), key).toBeNull()
            expect(resolveNetworkKey({ pathname: `/${key}/dao` }), key).toBe(DEFAULT_NETWORK)
            expect(resolveNetworkKey({ pref: key }), key).toBe(DEFAULT_NETWORK)
            expect(resolveDefaultNetwork(key), key).toBe("mainnet")
            expect(isRealmValidOn(key, "gno.land/r/gov/dao"), key).toBe(false)
            expect(networkHasAllowlistedRealms(key), key).toBe(false)
        }
    })

    it("non-retired networks, unknown keys and empty input have no successor", () => {
        for (const key of ["mainnet", "test13", "onyx", "no-such-network", "", null, undefined]) {
            expect(retiredNetworkSuccessor(key), String(key)).toBeNull()
        }
    })

    it("every declared successor is a real, non-retired network (no redirect chains or dead ends)", () => {
        for (const [key, { to, name }] of Object.entries(RETIRED_NETWORKS)) {
            expect(isNetworkKey(to), `${key} → ${to}`).toBe(true)
            expect(Object.hasOwn(RETIRED_NETWORKS, to), `${key} → ${to} must not be retired`).toBe(false)
            expect(name, key).not.toBe("")
        }
    })

    it("a retired network in the URL resolves to its successor; the path is not otherwise read", () => {
        expect(resolveNetworkKey({ pathname: "/pearl/dao/create" })).toBe("mainnet")
        expect(resolveNetworkKey({ pathname: "/pearl" })).toBe("mainnet")
        // A hidden-but-NOT-retired deep link is unaffected.
        expect(resolveNetworkKey({ pathname: "/test13/create-token" })).toBe("test13")
    })
})

describe("currentNetworkKey — the rule evaluated now, for code outside the router", () => {
    afterEach(() => {
        localStorage.clear()
        window.history.replaceState({}, "", "/")
    })

    it("follows the current URL, resolving a retired network to its successor", () => {
        window.history.replaceState({}, "", "/test13/directory")
        expect(currentNetworkKey()).toBe("test13")
        window.history.replaceState({}, "", "/pearl/directory")
        expect(currentNetworkKey()).toBe("mainnet")
        window.history.replaceState({}, "", "/sapphire/directory")
        expect(currentNetworkKey()).toBe("mainnet")
    })

    it("off a network URL, never returns the URL echo", () => {
        window.history.replaceState({}, "", "/directory")
        localStorage.setItem("memba_network", "pearl")
        expect(currentNetworkKey()).toBe(DEFAULT_NETWORK)
    })
})
