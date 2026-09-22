import { expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
vi.mock("../../../lib/gnowebSource", async importOriginal => ({ ...await importOriginal<typeof import("../../../lib/gnowebSource")>(), fetchRealmSourceSmart: vi.fn() }))
vi.mock("../../../lib/gnoFuncs", async importOriginal => ({ ...await importOriginal<typeof import("../../../lib/gnoFuncs")>(), fetchRealmFuncs: vi.fn().mockResolvedValue([]) }))
import { fetchRealmSourceSmart } from "../../../lib/gnowebSource"
import { ExplorerTab } from "./ExplorerTab"
it("offers a source retry and displays the recovered file", async () => {
    vi.mocked(fetchRealmSourceSmart).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ files: [{ name: "demo.gno", content: "package demo\n// Recovered source", lines: 2 }], functions: [], imports: [] })
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ExplorerTab realm="p/demo/boards2" onRealmChange={vi.fn()} /></QueryClientProvider>)
    fireEvent.click(await screen.findByRole("button", { name: "Retry source" }))
    expect(await screen.findByText(/Recovered source/)).toBeInTheDocument()
    expect(fetchRealmSourceSmart).toHaveBeenCalledTimes(2)
})
