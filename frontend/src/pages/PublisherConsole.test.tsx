import { screen, fireEvent, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderWithProviders } from "../test/test-utils"
import type { AppListing } from "../lib/appStore"

let submitEnabled = true
let v3 = true
let adena = { connected: true, address: "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0", connect: vi.fn() }
const fetchByPublisher = vi.fn()
const loadEditForm = vi.fn()
const doContractBroadcast = vi.fn()

vi.mock("../hooks/useAdena", () => ({ useAdena: () => adena }))
vi.mock("../lib/config", async (a) => ({
    ...await a<typeof import("../lib/config")>(), isAppStoreSubmitEnabled: () => submitEnabled,
}))
vi.mock("../lib/appStore", async (a) => {
    const actual = await a<typeof import("../lib/appStore")>()
    return { ...actual, isAppStoreV3: () => v3, fetchByPublisher: (...x: unknown[]) => fetchByPublisher(...x) }
})
vi.mock("../lib/appStoreSubmit", async (a) => {
    const actual = await a<typeof import("../lib/appStoreSubmit")>()
    return { ...actual, loadEditForm: (...x: unknown[]) => loadEditForm(...x) }
})
vi.mock("../lib/grc20", async (a) => ({
    ...await a<typeof import("../lib/grc20")>(), doContractBroadcast: (...x: unknown[]) => doContractBroadcast(...x),
}))

const { PublisherConsole } = await import("./PublisherConsole")

function listing(over: Partial<AppListing>): AppListing {
    return {
        id: 1, pkgPath: "gno.land/r/samcrew/mine_v1", name: "Mine", tagline: "", category: "",
        iconCID: "", appURL: "", publisher: adena.address, status: "pending", flagCount: 0, createdAt: 0, ...over,
    }
}

beforeEach(() => {
    submitEnabled = true
    v3 = true
    adena = { connected: true, address: "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0", connect: vi.fn() }
    fetchByPublisher.mockReset().mockResolvedValue([])
    loadEditForm.mockReset().mockResolvedValue(null)
    doContractBroadcast.mockReset().mockResolvedValue({ hash: "0x" })
})

describe("PublisherConsole — gates", () => {
    it("shows a not-open notice when submissions are gated off", () => {
        submitEnabled = false
        renderWithProviders(<PublisherConsole />, { route: "/test13/apps/my-submissions" })
        expect(screen.getByTestId("console-gated")).toBeInTheDocument()
    })

    it("asks a disconnected visitor to connect", () => {
        adena = { ...adena, connected: false, address: "" }
        renderWithProviders(<PublisherConsole />, { route: "/test13/apps/my-submissions" })
        expect(screen.getByRole("button", { name: /connect/i })).toBeInTheDocument()
    })
})

describe("PublisherConsole — listings", () => {
    it("fetches and lists the caller's submissions (first page)", async () => {
        fetchByPublisher.mockResolvedValue([listing({ name: "My App", status: "rejected", rejectReason: "nope" })])
        renderWithProviders(<PublisherConsole />, { route: "/test13/apps/my-submissions" })
        expect(await screen.findByText("My App")).toBeInTheDocument()
        expect(screen.getByText(/nope/)).toBeInTheDocument()
        expect(fetchByPublisher).toHaveBeenCalledWith(adena.address, 0, 20)
    })

    it("shows an empty state when the publisher has no apps", async () => {
        fetchByPublisher.mockResolvedValue([])
        renderWithProviders(<PublisherConsole />, { route: "/test13/apps/my-submissions" })
        expect(await screen.findByTestId("console-empty")).toBeInTheDocument()
    })
})

describe("PublisherConsole — inline edit", () => {
    it("opens an inline edit form seeded from full detail, then broadcasts EditListing on submit", async () => {
        fetchByPublisher.mockResolvedValue([listing({ pkgPath: "gno.land/r/samcrew/bad_v1", name: "Bad App", status: "rejected" })])
        loadEditForm.mockResolvedValue({
            pkgPath: "gno.land/r/samcrew/bad_v1", name: "Bad App", tagline: "", descr: "D",
            category: "", iconCID: "", screenshotsCSV: "s1,s2", appURL: "",
        })
        renderWithProviders(<PublisherConsole />, { route: "/test13/apps/my-submissions" })
        await screen.findByText("Bad App")
        fireEvent.click(screen.getByRole("button", { name: /fix & resubmit/i }))
        // The edit form opens IN PLACE, seeded from full on-chain detail — no navigation away.
        expect(await screen.findByLabelText(/description/i)).toHaveValue("D")
        expect(loadEditForm).toHaveBeenCalledWith("gno.land/r/samcrew/bad_v1")
        fireEvent.click(screen.getByRole("button", { name: /resubmit for review/i }))
        await waitFor(() => expect(doContractBroadcast).toHaveBeenCalledTimes(1))
        const [msgs] = doContractBroadcast.mock.calls[0]
        expect(msgs[0].value.func).toBe("EditListing")
        expect(msgs[0].value.send).toBe("")
        // descr + screenshots round-trip (the whole point of loadEditForm)
        expect(msgs[0].value.args[3]).toBe("D")
        expect(msgs[0].value.args[6]).toBe("s1,s2")
    })

    it("shows an error and does NOT open the edit form when full detail can't be loaded", async () => {
        fetchByPublisher.mockResolvedValue([listing({ pkgPath: "gno.land/r/samcrew/bad_v1", name: "Bad App", status: "rejected" })])
        loadEditForm.mockResolvedValue(null)
        renderWithProviders(<PublisherConsole />, { route: "/test13/apps/my-submissions" })
        await screen.findByText("Bad App")
        fireEvent.click(screen.getByRole("button", { name: /fix & resubmit/i }))
        expect(await screen.findByText(/couldn't load/i)).toBeInTheDocument()
        expect(screen.queryByTestId("console-editform")).not.toBeInTheDocument()
        expect(doContractBroadcast).not.toHaveBeenCalled()
    })

    it("Cancel closes the inline edit form without broadcasting", async () => {
        fetchByPublisher.mockResolvedValue([listing({ pkgPath: "gno.land/r/samcrew/bad_v1", name: "Bad App", status: "rejected" })])
        loadEditForm.mockResolvedValue({
            pkgPath: "gno.land/r/samcrew/bad_v1", name: "Bad App", tagline: "", descr: "D",
            category: "", iconCID: "", screenshotsCSV: "", appURL: "",
        })
        renderWithProviders(<PublisherConsole />, { route: "/test13/apps/my-submissions" })
        await screen.findByText("Bad App")
        fireEvent.click(screen.getByRole("button", { name: /fix & resubmit/i }))
        await screen.findByTestId("console-editform")
        fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }))
        expect(screen.queryByTestId("console-editform")).not.toBeInTheDocument()
        expect(doContractBroadcast).not.toHaveBeenCalled()
        expect(screen.getByText("Bad App")).toBeInTheDocument() // back to the list
    })
})

describe("PublisherConsole — delist", () => {
    it("arms, then broadcasts DelistApp and flips the row to Delisted", async () => {
        fetchByPublisher.mockResolvedValue([listing({ status: "live", name: "Live One" })])
        renderWithProviders(<PublisherConsole />, { route: "/test13/apps/my-submissions" })
        fireEvent.click(await screen.findByRole("button", { name: /^delist$/i }))
        expect(doContractBroadcast).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole("button", { name: /yes, delist/i }))
        await waitFor(() => expect(doContractBroadcast).toHaveBeenCalledTimes(1))
        expect(doContractBroadcast.mock.calls[0][0][0].value.func).toBe("DelistApp")
        await waitFor(() => expect(screen.getByText("Delisted")).toBeInTheDocument())
    })
})

describe("PublisherConsole — pagination", () => {
    it("advances the offset when the page is full", async () => {
        fetchByPublisher.mockResolvedValue(
            Array.from({ length: 20 }, (_, i) => listing({ id: i + 1, pkgPath: `gno.land/r/samcrew/a${i}_v1`, name: `App ${i}` })))
        renderWithProviders(<PublisherConsole />, { route: "/test13/apps/my-submissions" })
        await screen.findByText("App 0")
        fireEvent.click(screen.getByRole("button", { name: /next/i }))
        await waitFor(() => expect(fetchByPublisher).toHaveBeenCalledWith(adena.address, 20, 20))
    })
})
