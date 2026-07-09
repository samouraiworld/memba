import { screen, fireEvent, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderWithProviders } from "../test/test-utils"
import type { AppListing } from "../lib/appStore"

// Flip realm generation / wallet / curator per-test; keep the REAL msg builders so the
// broadcast assertions cover the actual wire shape.
let v3 = true
let adena = { connected: true, address: "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0", connect: vi.fn() }
const fetchByStatus = vi.fn()
const fetchIsCurator = vi.fn()
const doContractBroadcast = vi.fn()

vi.mock("../hooks/useAdena", () => ({ useAdena: () => adena }))
vi.mock("../lib/appStore", async (importActual) => {
    const actual = await importActual<typeof import("../lib/appStore")>()
    return {
        ...actual,
        isAppStoreV3: () => v3,
        fetchByStatus: (...a: unknown[]) => fetchByStatus(...a),
    }
})
vi.mock("../lib/appStoreCuration", async (importActual) => {
    const actual = await importActual<typeof import("../lib/appStoreCuration")>()
    return { ...actual, fetchIsCurator: (...a: unknown[]) => fetchIsCurator(...a) }
})
vi.mock("../lib/grc20", async (importActual) => {
    const actual = await importActual<typeof import("../lib/grc20")>()
    return { ...actual, doContractBroadcast: (...a: unknown[]) => doContractBroadcast(...a) }
})

const { AppCurator } = await import("./AppCurator")

function pending(over: Partial<AppListing>): AppListing {
    return {
        id: 1, pkgPath: "gno.land/r/samcrew/queued_v1", name: "Queued App", tagline: "waiting",
        category: "Tools", iconCID: "", appURL: "", publisher: "g1publisherpublisherpublisherpublisher",
        status: "pending", flagCount: 0, createdAt: 0, ...over,
    }
}

beforeEach(() => {
    v3 = true
    adena = { connected: true, address: "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0", connect: vi.fn() }
    fetchIsCurator.mockReset().mockResolvedValue(true)
    fetchByStatus.mockReset().mockResolvedValue([pending({})])
    doContractBroadcast.mockReset().mockResolvedValue({ hash: "0xabc" })
})

describe("AppCurator — gates", () => {
    it("shows a v3-required notice on the v2 realm", () => {
        v3 = false
        renderWithProviders(<AppCurator />, { route: "/test13/apps/review" })
        expect(screen.getByTestId("appcurator-v2")).toBeInTheDocument()
    })

    it("asks a disconnected visitor to connect", () => {
        adena = { ...adena, connected: false, address: "" }
        renderWithProviders(<AppCurator />, { route: "/test13/apps/review" })
        expect(screen.getByRole("button", { name: /connect/i })).toBeInTheDocument()
    })

    it("turns a non-curator away (UX only — the realm enforces on-chain regardless)", async () => {
        fetchIsCurator.mockResolvedValue(false)
        renderWithProviders(<AppCurator />, { route: "/test13/apps/review" })
        expect(await screen.findByTestId("appcurator-denied")).toBeInTheDocument()
        expect(fetchByStatus).not.toHaveBeenCalled()
    })
})

describe("AppCurator — the pending queue", () => {
    it("lists pending submissions with their identity fields and a source link", async () => {
        renderWithProviders(<AppCurator />, { route: "/test13/apps/review" })
        expect(await screen.findByText("Queued App")).toBeInTheDocument()
        expect(screen.getByText("gno.land/r/samcrew/queued_v1")).toBeInTheDocument()
        expect(fetchByStatus).toHaveBeenCalledWith("pending", 0, 50)
    })

    it("shows a clear empty state when nothing is pending", async () => {
        fetchByStatus.mockResolvedValue([])
        renderWithProviders(<AppCurator />, { route: "/test13/apps/review" })
        expect(await screen.findByText(/queue is clear/i)).toBeInTheDocument()
    })
})

describe("AppCurator — approve", () => {
    it("broadcasts ApproveApp for the listing and removes it from the queue", async () => {
        renderWithProviders(<AppCurator />, { route: "/test13/apps/review" })
        await screen.findByText("Queued App")
        fireEvent.click(screen.getByRole("button", { name: /^approve/i }))
        await waitFor(() => expect(doContractBroadcast).toHaveBeenCalledTimes(1))
        const [msgs] = doContractBroadcast.mock.calls[0]
        expect(msgs[0].value.func).toBe("ApproveApp")
        expect(msgs[0].value.send).toBe("")
        expect(msgs[0].value.args).toEqual(["gno.land/r/samcrew/queued_v1"])
        await waitFor(() => expect(screen.queryByText("Queued App")).not.toBeInTheDocument())
    })
})

describe("AppCurator — reject", () => {
    it("requires a written reason before the on-chain reject can be sent", async () => {
        renderWithProviders(<AppCurator />, { route: "/test13/apps/review" })
        await screen.findByText("Queued App")
        fireEvent.click(screen.getByRole("button", { name: /^reject/i }))
        // The confirm control is disabled until the curator explains why (the reason is
        // shown verbatim to the submitter and gates their free resubmit).
        const confirm = screen.getByTestId("appcurator-reject-confirm")
        expect(confirm).toBeDisabled()
        fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "broken link" } })
        expect(confirm).toBeEnabled()
        fireEvent.click(confirm)
        await waitFor(() => expect(doContractBroadcast).toHaveBeenCalledTimes(1))
        const [msgs] = doContractBroadcast.mock.calls[0]
        expect(msgs[0].value.func).toBe("RejectApp")
        expect(msgs[0].value.args).toEqual(["gno.land/r/samcrew/queued_v1", "broken link"])
        await waitFor(() => expect(screen.queryByText("Queued App")).not.toBeInTheDocument())
    })
})
