import { beforeEach, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
vi.mock("../../../lib/gnowebSource", async importOriginal => ({ ...await importOriginal<typeof import("../../../lib/gnowebSource")>(), fetchRealmSourceSmart: vi.fn() }))
vi.mock("../../../lib/rpcFallback", async importOriginal => ({ ...await importOriginal<typeof import("../../../lib/rpcFallback")>(), resilientAbciQueryDetailed: vi.fn().mockResolvedValue({ kind: "empty" }) }))
vi.mock("../../../lib/dao/chainIdentity", () => ({ assertRpcChain: vi.fn().mockResolvedValue(undefined) }))
vi.mock("../../../hooks/useDirectoryRender", () => ({ useDirectoryRender: () => ({ data: null, loading: false, isError: false, refetch: vi.fn() }) }))
import { fetchRealmSourceSmart } from "../../../lib/gnowebSource"
import { resilientAbciQueryDetailed } from "../../../lib/rpcFallback"
import { assertRpcChain } from "../../../lib/dao/chainIdentity"
import type { GnoFunc } from "../../../lib/gnoFuncs"
import { ExplorerTab } from "./ExplorerTab"

const qfuncs = (funcs: GnoFunc[]) => ({ kind: "ok" as const, text: JSON.stringify(funcs.map(fn => ({
    FuncName: fn.name,
    Params: fn.params.map(p => ({ Name: p.name, Type: p.type })),
    Results: fn.results.map(p => ({ Name: p.name, Type: p.type })),
}))) })

beforeEach(() => {
    vi.mocked(resilientAbciQueryDetailed).mockReset().mockResolvedValue({ kind: "empty" })
    vi.mocked(assertRpcChain).mockReset().mockResolvedValue(undefined)
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

it("defers expensive reads until the selected view needs them", async () => {
    vi.mocked(resilientAbciQueryDetailed).mockResolvedValue(qfuncs([{ name: "Read", params: [], results: [] }]))
    vi.mocked(fetchRealmSourceSmart).mockResolvedValue(null)
    show("r/demo/lazy")
    expect(fetchRealmSourceSmart).not.toHaveBeenCalled()
    expect(resilientAbciQueryDetailed).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("tab", { name: "Functions" }))
    expect(await screen.findByText("Read()")).toBeInTheDocument()
    expect(fetchRealmSourceSmart).not.toHaveBeenCalled()
})

it("labels a source view truncated at the 24-file bound", async () => {
    vi.mocked(fetchRealmSourceSmart).mockResolvedValue({ files: [{ name: "demo.gno", content: "package demo", lines: 1 }], functions: [], imports: [], truncated: true })
    show("p/demo/big")
    expect(await screen.findByText(/More files exist in this package/)).toBeInTheDocument()
})

it("labels source-only function names, with unknown signatures, after a qfuncs failure and recovers on Retry", async () => {
    vi.mocked(resilientAbciQueryDetailed).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(qfuncs([{ name: "Read", params: [{ name: "n", type: "int" }], results: [] }]))
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
    vi.mocked(resilientAbciQueryDetailed).mockResolvedValueOnce({ kind: "empty" })
    vi.mocked(fetchRealmSourceSmart).mockResolvedValue({ files: [], functions: [], imports: [] })
    show("r/demo/empty")
    fireEvent.click(screen.getByRole("tab", { name: "Functions" }))
    expect(await screen.findByText("No exported functions found.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Retry functions" })).not.toBeInTheDocument()
})

it("offers retry instead of claiming no functions when qfuncs fails without a source fallback", async () => {
    vi.mocked(resilientAbciQueryDetailed).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(qfuncs([{ name: "Recovered", params: [], results: [] }]))
    vi.mocked(fetchRealmSourceSmart).mockResolvedValue({ files: [], functions: [], imports: [] })
    show("r/demo/retry")
    fireEvent.click(screen.getByRole("tab", { name: "Functions" }))
    expect(await screen.findByRole("button", { name: "Retry functions" })).toBeInTheDocument()
    expect(screen.queryByText("No exported functions found.")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Retry functions" }))
    expect(await screen.findByText("Recovered()")).toBeInTheDocument()
})

it("warns and offers retry when a refresh fails but cached signatures remain", async () => {
    const first = [{ name: "Read", params: [{ name: "n", type: "int" }], results: [] }]
    const recovered = [{ name: "Read", params: [{ name: "n", type: "string" }], results: [] }]
    vi.mocked(resilientAbciQueryDetailed).mockResolvedValueOnce(qfuncs(first)).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(qfuncs(recovered))
    vi.mocked(fetchRealmSourceSmart).mockResolvedValue({ files: [], functions: [], imports: [] })
    const { client } = show("r/demo/cached")
    fireEvent.click(screen.getByRole("tab", { name: "Functions" }))
    expect(await screen.findByText("Read(n int)")).toBeInTheDocument()

    await act(async () => { await client.refetchQueries({ predicate: query => query.queryKey[0] === "realm" && query.queryKey[1] === "functions" }) })
    expect(resilientAbciQueryDetailed).toHaveBeenCalledTimes(2)
    expect(client.getQueryCache().findAll({ predicate: query => query.queryKey[1] === "functions" })[0]?.state.status).toBe("error")
    expect(screen.getByText("Read(n int)")).toBeInTheDocument()
    expect(await screen.findByText(/Could not refresh functions; showing previously loaded signatures/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Retry functions" }))
    expect(await screen.findByText("Read(n string)")).toBeInTheDocument()
    expect(screen.queryByText(/Could not refresh functions/)).not.toBeInTheDocument()
})

it("keeps the current realm's functions when an older request settles later", async () => {
    let resolveOld!: (value: ReturnType<typeof qfuncs>) => void
    const older = new Promise<ReturnType<typeof qfuncs>>(resolve => { resolveOld = resolve })
    vi.mocked(resilientAbciQueryDetailed).mockImplementation((_query, path) => path.includes("old") ? older : Promise.resolve(qfuncs([{ name: "Current", params: [], results: [] }])))
    vi.mocked(fetchRealmSourceSmart).mockResolvedValue({ files: [], functions: [], imports: [] })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = show("r/demo/old", client)
    fireEvent.click(screen.getByRole("tab", { name: "Functions" }))
    view.rerender(<QueryClientProvider client={client}><ExplorerTab realm="r/demo/current" onRealmChange={vi.fn()} /></QueryClientProvider>)
    fireEvent.click(screen.getByRole("tab", { name: "Functions" }))
    expect(await screen.findByText("Current()")).toBeInTheDocument()
    await act(async () => { resolveOld(qfuncs([{ name: "Old", params: [], results: [] }])); await older })
    expect(screen.queryByText("Old()")).not.toBeInTheDocument()
})

it("verifies the endpoint serving qfuncs and fails closed on a mismatched chain", async () => {
    vi.mocked(assertRpcChain).mockRejectedValue(new Error("wrong chain"))
    vi.mocked(resilientAbciQueryDetailed).mockImplementation(async (_query, _path, verify) => {
        await verify?.("https://fallback.example")
        return qfuncs([{ name: "WrongChain", params: [], results: [] }])
    })
    vi.mocked(fetchRealmSourceSmart).mockResolvedValue(null)
    show("r/demo/untrusted")
    fireEvent.click(screen.getByRole("tab", { name: "Functions" }))
    expect(await screen.findByRole("button", { name: "Retry functions" })).toBeInTheDocument()
    expect(screen.queryByText("WrongChain()")).not.toBeInTheDocument()
    expect(assertRpcChain).toHaveBeenCalledWith("https://fallback.example", expect.any(String))
})
