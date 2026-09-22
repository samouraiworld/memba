import { beforeEach, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
vi.mock("../../../lib/gnowebSource", async importOriginal => ({ ...await importOriginal<typeof import("../../../lib/gnowebSource")>(), fetchRealmSourceSmart: vi.fn() }))
vi.mock("../../../lib/gnoFuncs", async importOriginal => ({ ...await importOriginal<typeof import("../../../lib/gnoFuncs")>(), fetchRealmFuncs: vi.fn().mockResolvedValue([]) }))
vi.mock("../../../hooks/useDirectoryRender", () => ({ useDirectoryRender: () => ({ data: null, loading: false, isError: false, refetch: vi.fn() }) }))
import { fetchRealmSourceSmart } from "../../../lib/gnowebSource"
import { fetchRealmFuncs } from "../../../lib/gnoFuncs"
import { ExplorerTab } from "./ExplorerTab"

beforeEach(() => {
    vi.mocked(fetchRealmFuncs).mockReset().mockResolvedValue([])
    vi.mocked(fetchRealmSourceSmart).mockReset()
})

function show(realm: string, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
    const view = render(<QueryClientProvider client={client}><ExplorerTab realm={realm} onRealmChange={vi.fn()} /></QueryClientProvider>)
    return { ...view, client }
}

it("offers a source retry and displays the recovered file", async () => {
    vi.mocked(fetchRealmSourceSmart).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ files: [{ name: "demo.gno", content: "package demo\n// Recovered source", lines: 2 }], functions: [], imports: [] })
    show("p/demo/boards2")
    fireEvent.click(await screen.findByRole("button", { name: "Retry source" }))
    expect(await screen.findByText(/Recovered source/)).toBeInTheDocument()
    expect(fetchRealmSourceSmart).toHaveBeenCalledTimes(2)
})

it("labels source-only function names, with unknown signatures, after a qfuncs failure and recovers on Retry", async () => {
    vi.mocked(fetchRealmFuncs).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([{ name: "Read", params: [{ name: "n", type: "int" }], results: [] }])
    vi.mocked(fetchRealmSourceSmart).mockResolvedValue({ files: [], functions: [{ name: "Read", params: "(n int)", returns: "", isExported: true }], imports: [] })
    show("r/demo/reads")
    fireEvent.click(screen.getByRole("tab", { name: "Functions" }))
    expect(await screen.findByText("Read")).toBeInTheDocument()
    expect(screen.getByText(/Function names from source; signatures unavailable/)).toBeInTheDocument()
    expect(screen.queryByText("Read()")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Retry functions" }))
    expect(await screen.findByText("Read(n int)")).toBeInTheDocument()
    expect(screen.queryByText(/Function names from source/)).not.toBeInTheDocument()
})

it("distinguishes a successful empty read from a failure when source has no names", async () => {
    vi.mocked(fetchRealmFuncs).mockResolvedValueOnce([])
    vi.mocked(fetchRealmSourceSmart).mockResolvedValue({ files: [], functions: [], imports: [] })
    show("r/demo/empty")
    fireEvent.click(screen.getByRole("tab", { name: "Functions" }))
    expect(await screen.findByText("No exported functions found.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Retry functions" })).not.toBeInTheDocument()
})

it("offers retry instead of claiming no functions when qfuncs fails without a source fallback", async () => {
    vi.mocked(fetchRealmFuncs).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([{ name: "Recovered", params: [], results: [] }])
    vi.mocked(fetchRealmSourceSmart).mockResolvedValue({ files: [], functions: [], imports: [] })
    show("r/demo/retry")
    fireEvent.click(screen.getByRole("tab", { name: "Functions" }))
    expect(await screen.findByRole("button", { name: "Retry functions" })).toBeInTheDocument()
    expect(screen.queryByText("No exported functions found.")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Retry functions" }))
    expect(await screen.findByText("Recovered()")).toBeInTheDocument()
})

it("keeps the current realm's functions when an older request settles later", async () => {
    let resolveOld!: (value: { name: string; params: []; results: [] }[]) => void
    const older = new Promise<{ name: string; params: []; results: [] }[]>(resolve => { resolveOld = resolve })
    vi.mocked(fetchRealmFuncs).mockImplementation(path => path.includes("old") ? older : Promise.resolve([{ name: "Current", params: [], results: [] }]))
    vi.mocked(fetchRealmSourceSmart).mockResolvedValue({ files: [], functions: [], imports: [] })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = show("r/demo/old", client)
    fireEvent.click(screen.getByRole("tab", { name: "Functions" }))
    view.rerender(<QueryClientProvider client={client}><ExplorerTab realm="r/demo/current" onRealmChange={vi.fn()} /></QueryClientProvider>)
    fireEvent.click(screen.getByRole("tab", { name: "Functions" }))
    expect(await screen.findByText("Current()")).toBeInTheDocument()
    await act(async () => { resolveOld([{ name: "Old", params: [], results: [] }]); await older })
    expect(screen.queryByText("Old()")).not.toBeInTheDocument()
})
