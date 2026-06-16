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
