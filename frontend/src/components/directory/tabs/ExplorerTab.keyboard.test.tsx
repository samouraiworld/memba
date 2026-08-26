/**
 * ExplorerTab — realm-view tablist keyboard wiring.
 *
 * First test file for this component; scoped to the tablist adoption. The APG
 * keyboard contract itself is covered in hooks/useTabListKeyboard.test.tsx —
 * what these pin is that the Render/Source/Functions tablist is actually wired
 * through the hook: the roving tabindex only exists if tabProps is spread, and
 * arrow-selection only works if onSelect reaches setTab.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

vi.mock("../../../hooks/useNetwork", () => ({
    useNetwork: () => ({ networkKey: "sapphire" }),
}))

vi.mock("../../../lib/dao/shared", () => ({
    queryRender: vi.fn().mockResolvedValue("# demo realm"),
}))

vi.mock("../../../lib/gnowebSource", () => ({
    fetchRealmSourceSmart: vi.fn().mockResolvedValue({ files: [], functions: [] }),
}))

vi.mock("../../../lib/gnoFuncs", async () => {
    const actual = await vi.importActual<typeof import("../../../lib/gnoFuncs")>("../../../lib/gnoFuncs")
    return {
        ...actual,
        fetchRealmFuncs: vi.fn().mockResolvedValue([]),
    }
})

import { ExplorerTab } from "./ExplorerTab"

const tab = (name: RegExp) => screen.getByRole("tab", { name })

async function renderRealmView() {
    render(<ExplorerTab realm="r/demo/x" onRealmChange={vi.fn()} />)
    // The tablist belongs to RealmView, which mounts once a realm is set.
    await screen.findByRole("tab", { name: /render/i })
}

describe("ExplorerTab — realm tablist keyboard (APG)", () => {
    it("gives the view tabs a roving tabindex (single tab stop)", async () => {
        await renderRealmView()

        expect(tab(/render/i)).toHaveAttribute("aria-selected", "true")
        expect(tab(/render/i)).toHaveAttribute("tabindex", "0")
        expect(tab(/source/i)).toHaveAttribute("tabindex", "-1")
        expect(tab(/functions/i)).toHaveAttribute("tabindex", "-1")
    })

    it("ArrowRight moves selection from Render to Source", async () => {
        await renderRealmView()

        fireEvent.keyDown(tab(/render/i), { key: "ArrowRight" })
        expect(tab(/source/i)).toHaveAttribute("aria-selected", "true")
        expect(tab(/source/i)).toHaveAttribute("tabindex", "0")
        expect(tab(/render/i)).toHaveAttribute("tabindex", "-1")
    })
})
