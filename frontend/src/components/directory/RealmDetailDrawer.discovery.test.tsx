import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
vi.mock("../../hooks/useNetwork", () => ({ useNetwork: () => ({ networkKey: "pearl" }) }))
vi.mock("../../lib/dao/shared", () => ({ queryRender: vi.fn().mockResolvedValue("# Realm") }))
vi.mock("../../lib/gnowebSource", () => ({ fetchRealmSourceSmart: vi.fn().mockResolvedValue({ files: [], functions: [], imports: [] }) }))
import { RealmDetailDrawer } from "./RealmDetailDrawer"
import { NETWORKS } from "../../lib/config"
import { queryRender } from "../../lib/dao/shared"
import { fetchRealmSourceSmart } from "../../lib/gnowebSource"
describe("Directory drawer network and URL identity", () => {
    it.each(["full", "origin", "other-network"])("normalizes a %s URL once and opens packages without Render", async variant => {
        vi.clearAllMocks()
        const base = NETWORKS.pearl.explorerUrl
        const path = "gno.land/p/samcrew/demo"
        const url = variant === "full" ? `${base}/p/samcrew/demo` : variant === "origin" ? base : "https://gno.land/p/samcrew/demo"
        render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RealmDetailDrawer path={path} isPackage gnowebUrl={url} onClose={vi.fn()} /></QueryClientProvider></MemoryRouter>)
        expect(screen.queryByRole("button", { name: /Render/ })).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: /Info/ }))
        expect(await screen.findByRole("link", { name: "Open in gnoweb →" })).toHaveAttribute("href", `${base}/p/samcrew/demo`)
        expect(fetchRealmSourceSmart).toHaveBeenCalledWith(base, "/p/samcrew/demo")
        expect(queryRender).not.toHaveBeenCalled()
    })
})
