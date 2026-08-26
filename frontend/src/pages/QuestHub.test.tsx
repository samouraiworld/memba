/**
 * QuestHub — category tablist keyboard wiring.
 *
 * First test file for this page; scoped to the tablist adoption. The APG
 * keyboard contract itself is covered in hooks/useTabListKeyboard.test.tsx —
 * what these pin is that the page is actually wired through the hook: the
 * roving tabindex only exists if tabProps is spread, and arrow-selection only
 * works if onSelect reaches setCategory.
 *
 * No network mocks needed: the quest catalog is static data and backend quest
 * state only loads once a wallet is connected, so the wallet mocks as absent.
 */
import { describe, it, expect, vi } from "vitest"
import { screen, fireEvent } from "@testing-library/react"
import { renderWithProviders } from "../test/test-utils"

vi.mock("../hooks/useAdena", () => ({
    useAdena: () => ({
        connected: false,
        address: "",
        pubkeyJSON: "",
        chainId: "",
        installed: false,
        loading: false,
        connect: vi.fn().mockResolvedValue(false),
        disconnect: vi.fn(),
        signArbitrary: vi.fn().mockResolvedValue(null),
    }),
}))

import QuestHub from "./QuestHub"

const tab = (name: RegExp) => screen.getByRole("tab", { name })

describe("QuestHub — category tablist keyboard (APG)", () => {
    it("gives the category tabs a roving tabindex (single tab stop)", () => {
        renderWithProviders(<QuestHub />, { route: "/sapphire/quests" })

        expect(tab(/^All/)).toHaveAttribute("aria-selected", "true")
        expect(tab(/^All/)).toHaveAttribute("tabindex", "0")
        expect(tab(/^Developers/)).toHaveAttribute("tabindex", "-1")
        expect(tab(/^Everyone/)).toHaveAttribute("tabindex", "-1")
        expect(tab(/^Champion/)).toHaveAttribute("tabindex", "-1")
    })

    it("ArrowRight moves selection to the next category", () => {
        renderWithProviders(<QuestHub />, { route: "/sapphire/quests" })

        fireEvent.keyDown(tab(/^All/), { key: "ArrowRight" })
        expect(tab(/^Developers/)).toHaveAttribute("aria-selected", "true")
        expect(tab(/^Developers/)).toHaveAttribute("tabindex", "0")
        expect(tab(/^All/)).toHaveAttribute("tabindex", "-1")
    })

    it("End jumps to the last category and wraps forward to the first", () => {
        renderWithProviders(<QuestHub />, { route: "/sapphire/quests" })

        fireEvent.keyDown(tab(/^All/), { key: "End" })
        expect(tab(/^Champion/)).toHaveAttribute("aria-selected", "true")

        fireEvent.keyDown(tab(/^Champion/), { key: "ArrowRight" })
        expect(tab(/^All/)).toHaveAttribute("aria-selected", "true")
    })
})
