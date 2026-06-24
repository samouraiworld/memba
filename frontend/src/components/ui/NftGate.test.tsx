/**
 * NftGate — security regression guard for P0-1.
 *
 * Invariant: with VITE_ENABLE_NFT off, an NFT route must NOT render its content
 * (the live mint/trade UI). This is the gate that was missing on the
 * collection / creator / studio routes, leaving on-chain mint reachable by
 * direct URL while the feature was nominally disabled.
 */
import { describe, it, expect, afterEach, vi } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithProviders } from "../../test/test-utils"
import { NftGate } from "./NftGate"

afterEach(() => {
    vi.unstubAllEnvs()
})

describe("NftGate", () => {
    it("hides children behind a Coming-Soon gate when VITE_ENABLE_NFT is not 'true'", () => {
        vi.stubEnv("VITE_ENABLE_NFT", "false")
        renderWithProviders(
            <NftGate>
                <div>NFT_LIVE_CONTENT</div>
            </NftGate>,
        )
        expect(screen.getByTestId("coming-soon-gate")).toBeInTheDocument()
        expect(screen.queryByText("NFT_LIVE_CONTENT")).not.toBeInTheDocument()
    })

    it("renders children verbatim when VITE_ENABLE_NFT is 'true'", () => {
        vi.stubEnv("VITE_ENABLE_NFT", "true")
        renderWithProviders(
            <NftGate>
                <div>NFT_LIVE_CONTENT</div>
            </NftGate>,
        )
        expect(screen.getByText("NFT_LIVE_CONTENT")).toBeInTheDocument()
        expect(screen.queryByTestId("coming-soon-gate")).not.toBeInTheDocument()
    })
})
