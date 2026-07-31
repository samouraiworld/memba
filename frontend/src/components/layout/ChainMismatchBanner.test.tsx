/**
 * Regression test for the test13 chainId↔key mismatch.
 *
 * NETWORKS is keyed by an identifier-safe map KEY (e.g. "test13") while the
 * on-wire chainId is hyphenated ("test-13"). ChainMismatchBanner receives the
 * wallet's *chainId*; it must resolve that to the network KEY before deciding
 * whether the wallet's chain is a known Memba network and before calling
 * switchMembaNetwork (which takes a KEY). Looking the chainId up as a key
 * silently breaks ONLY for test13 (every other network has key === chainId).
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ChainMismatchBanner } from "./TopBar"

const networks = {
    test12: { label: "Testnet 12", chainId: "test12", rpcUrl: "https://rpc.testnet12.samourai.live:443" },
    test13: { label: "Testnet 13", chainId: "test-13", rpcUrl: "https://rpc.test13.testnets.gno.land:443" },
}

describe("ChainMismatchBanner — test13 chainId/key resolution", () => {
    it("treats a wallet on the test-13 chainId as a known Memba network", () => {
        const switchMembaNetwork = vi.fn()
        render(
            <ChainMismatchBanner
                walletChainId="test-13"
                membaChainId="test12"
                networks={networks}
                switchMembaNetwork={switchMembaNetwork}
            />,
        )
        // The "Switch Memba to <network>" action must be offered (wallet IS on a known net).
        const btn = screen.getByRole("button", { name: /switch memba to/i })
        fireEvent.click(btn)
        // …and it must switch by KEY ("test13"), not the chainId ("test-13").
        expect(switchMembaNetwork).toHaveBeenCalledWith("test13")
    })

    it("still works for a network whose key equals its chainId (test12)", () => {
        const switchMembaNetwork = vi.fn()
        render(
            <ChainMismatchBanner
                walletChainId="test12"
                membaChainId="test-13"
                networks={networks}
                switchMembaNetwork={switchMembaNetwork}
            />,
        )
        fireEvent.click(screen.getByRole("button", { name: /switch memba to/i }))
        expect(switchMembaNetwork).toHaveBeenCalledWith("test12")
    })
})

/**
 * The FOURTH surface that could put a user on a hidden network — and the worst
 * one, because it renders only while a wallet is CONNECTED, i.e. exactly the
 * cohort that hits F-29 (login succeeds on gnoland1, then every call 401s with no
 * self-heal). The switcher, the mobile tab bar and Settings were all filtered
 * through `selectableNetworksFor`; this one resolved against the full NETWORKS map
 * and rendered a literal "Switch Memba to Betanet (gnoland1)" button.
 */
describe("ChainMismatchBanner — never offers to follow the wallet onto a HIDDEN network", () => {
    const withHidden = {
        topaz: { label: "Topaz", chainId: "topaz-1", rpcUrl: "https://rpc.topaz.samourai.live:443" },
        gnoland1: { label: "Betanet (gnoland1)", chainId: "gnoland1", rpcUrl: "https://rpc.gnoland1.samourai.live:443", hidden: true },
    }

    it("does NOT offer to switch Memba to a hidden network", () => {
        const switchMembaNetwork = vi.fn()
        render(
            <ChainMismatchBanner
                walletChainId="gnoland1"
                membaChainId="topaz-1"
                networks={withHidden}
                switchMembaNetwork={switchMembaNetwork}
            />,
        )
        expect(screen.queryByRole("button", { name: /switch memba to/i })).toBeNull()
        expect(screen.queryByText(/Betanet/)).toBeNull()
    })

    it("still NAMES the wallet's chain, so the warning stays truthful", () => {
        render(
            <ChainMismatchBanner
                walletChainId="gnoland1"
                membaChainId="topaz-1"
                networks={withHidden}
                switchMembaNetwork={vi.fn()}
            />,
        )
        // Detection still uses the full map — only the OFFER is withheld.
        expect(screen.getByText(/Network mismatch/)).toBeInTheDocument()
        expect(screen.getByText("gnoland1")).toBeInTheDocument()
    })

    it("falls through to the wallet-side fix, which is the correct advice", () => {
        const addAndSwitchWallet = vi.fn().mockResolvedValue(true)
        render(
            <ChainMismatchBanner
                walletChainId="gnoland1"
                membaChainId="topaz-1"
                networks={withHidden}
                switchMembaNetwork={vi.fn()}
                addAndSwitchWallet={addAndSwitchWallet}
            />,
        )
        // Memba cannot follow the wallet to a network it no longer offers, so the
        // remedy is to move the WALLET to the chain Memba is on.
        expect(screen.getByRole("button", { name: /switch.*wallet|adena/i })).toBeInTheDocument()
    })

    it("still offers the switch for a VISIBLE network", () => {
        const switchMembaNetwork = vi.fn()
        render(
            <ChainMismatchBanner
                walletChainId="topaz-1"
                membaChainId="gnoland1"
                networks={withHidden}
                switchMembaNetwork={switchMembaNetwork}
            />,
        )
        fireEvent.click(screen.getByRole("button", { name: /switch memba to/i }))
        expect(switchMembaNetwork).toHaveBeenCalledWith("topaz")
    })
})
