import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { Dock } from "./Dock"

const props = { wins: [], openApp: vi.fn(), restore: vi.fn(), locked: false }

describe("Dock per network family", () => {
    it("keeps the gno.land apps on gno.land", () => {
        render(<Dock {...props} family="gno" />)
        expect(screen.getByRole("button", { name: "Validators" })).toBeInTheDocument()
    })

    it("shows only Settings on an EVM network, where no dock app runs yet", () => {
        render(<Dock {...props} family="evm" />)
        expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Settings"])
    })
})
