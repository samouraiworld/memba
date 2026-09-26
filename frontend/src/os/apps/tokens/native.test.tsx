import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import TokensWindow from "./native"

const availability = vi.hoisted(() => ({ factory: false }))
vi.mock("../../../lib/config", async (original) => ({
    ...(await original<typeof import("../../../lib/config")>()),
    isRealmValidOn: () => availability.factory,
}))

const session = (key: string) => ({ network: { key } }) as never
const fallback = <p>classic token page</p>
const props = (key: string) => ({ session: session(key), fallback }) as never

describe("Tokens window", () => {
    beforeEach(() => { availability.factory = false })

    it("explains the missing mainnet factory without exposing the classic token actions", () => {
        render(<TokensWindow {...props("mainnet")} />)
        expect(screen.getByRole("note")).toHaveTextContent("screens are implemented")
        expect(screen.getByRole("note")).toHaveTextContent("factory is not deployed")
        expect(screen.queryByText("classic token page")).toBeNull()
    })

    it("uses a neutral unavailable state for another network", () => {
        render(<TokensWindow {...props("test13")} />)
        expect(screen.getByRole("note")).toHaveTextContent("factory is not available")
    })

    it("preserves the existing classic page where the factory is available", () => {
        availability.factory = true
        render(<TokensWindow {...props("test13")} />)
        expect(screen.getByText("classic token page")).toBeInTheDocument()
        expect(screen.queryByRole("note")).toBeNull()
    })
})
