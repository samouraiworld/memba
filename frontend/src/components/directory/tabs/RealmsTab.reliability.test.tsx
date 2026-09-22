import { act, fireEvent, render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { queryRender } from "../../../lib/dao/shared"
vi.mock("../../../lib/dao/shared", () => ({ queryRender: vi.fn() }))
vi.mock("../../../hooks/useDirectoryDiscovery", () => ({ useDirectoryDiscovery: () => ({ discovery: { realms: ["alpha", "beta"].map(name => ({ name, path: `gno.land/r/demo/${name}`, category: "social", description: "reference" })) } }) }))
import { RealmsTab } from "./RealmsTab"
it("keeps the expanded realm's response when an earlier read finishes late", async () => {
    let alpha!: (value: string) => void, beta!: (value: string) => void
    vi.mocked(queryRender).mockReturnValueOnce(new Promise(r => { alpha = r })).mockReturnValueOnce(new Promise(r => { beta = r }))
    render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RealmsTab /></QueryClientProvider></MemoryRouter>)
    fireEvent.click(screen.getByRole("button", { name: /alpha/ }))
    fireEvent.click(screen.getByRole("button", { name: /beta/ }))
    await act(async () => { beta("Beta preview") })
    await act(async () => { alpha("Stale alpha preview") })
    expect(await screen.findByText("Beta preview")).toBeInTheDocument()
    expect(screen.queryByText("Stale alpha preview")).not.toBeInTheDocument()
})
