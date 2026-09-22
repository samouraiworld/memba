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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, fireEvent } from "@testing-library/react"

vi.mock("../../../hooks/useNetwork", () => ({
    useNetwork: () => ({ networkKey: "sapphire" }),
}))

vi.mock("../../../lib/dao/shared", () => ({
    queryRender: vi.fn().mockResolvedValue("# demo realm"),
}))

vi.mock("../../../lib/gnowebSource", async importOriginal => ({
    ...await importOriginal<typeof import("../../../lib/gnowebSource")>(),
    fetchRealmSourceSmart: vi.fn().mockResolvedValue({ files: [], functions: [] }),
}))

vi.mock("../../../lib/gnoFuncs", async () => {
    const actual = await vi.importActual<typeof import("../../../lib/gnoFuncs")>("../../../lib/gnoFuncs")
    return {
        ...actual,
        fetchRealmFuncs: vi.fn().mockResolvedValue([]),
    }
})

import { queryRender } from "../../../lib/dao/shared"
import { ExplorerTab } from "./ExplorerTab"

const tab = (name: RegExp) => screen.getByRole("tab", { name })

async function renderRealmView() {
    render(<QueryClientProvider client={new QueryClient()}><ExplorerTab realm="r/demo/x" onRealmChange={vi.fn()} /></QueryClientProvider>)
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


it("opens package deep links on Source without a Render request", async () => {
    vi.mocked(queryRender).mockClear()
    render(<QueryClientProvider client={new QueryClient()}><ExplorerTab realm="p/demo/boards2" onRealmChange={vi.fn()} /></QueryClientProvider>)
    expect(await screen.findByRole("tab", { name: "Source" })).toHaveAttribute("aria-selected", "true")
    expect(screen.queryByRole("tab", { name: "Render" })).not.toBeInTheDocument()
    expect(queryRender).not.toHaveBeenCalled()
})
