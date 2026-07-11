import { screen, fireEvent, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderWithProviders } from "../test/test-utils"
import type { AppListing } from "../lib/appStore"

// Flip the gates + wallet per-test; keep the REAL validation and msg builders (that's the
// point of the page: it must refuse to broadcast what the realm would reject).
let submitEnabled = true
let v3 = true
let adena = { connected: true, address: "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0", connect: vi.fn() }
const fetchByPublisher = vi.fn()
const fetchRegistrationFee = vi.fn()
const doContractBroadcast = vi.fn()

vi.mock("../hooks/useAdena", () => ({ useAdena: () => adena }))
vi.mock("../lib/config", async (importActual) => {
    const actual = await importActual<typeof import("../lib/config")>()
    return { ...actual, isAppStoreSubmitEnabled: () => submitEnabled }
})
vi.mock("../lib/appStore", async (importActual) => {
    const actual = await importActual<typeof import("../lib/appStore")>()
    return {
        ...actual,
        isAppStoreV3: () => v3,
        fetchByPublisher: (...a: unknown[]) => fetchByPublisher(...a),
    }
})
vi.mock("../lib/appStoreSubmit", async (importActual) => {
    const actual = await importActual<typeof import("../lib/appStoreSubmit")>()
    return { ...actual, fetchRegistrationFee: () => fetchRegistrationFee() }
})
vi.mock("../lib/grc20", async (importActual) => {
    const actual = await importActual<typeof import("../lib/grc20")>()
    return { ...actual, doContractBroadcast: (...a: unknown[]) => doContractBroadcast(...a) }
})

const { AppSubmit } = await import("./AppSubmit")

function mine(over: Partial<AppListing>): AppListing {
    return {
        id: 1, pkgPath: "gno.land/r/samcrew/mine_v1", name: "Mine", tagline: "", category: "",
        iconCID: "", appURL: "", publisher: adena.address, status: "pending", flagCount: 0,
        createdAt: 0, ...over,
    }
}

function fillRequired() {
    fireEvent.change(screen.getByLabelText(/package path/i), {
        target: { value: "gno.land/r/samcrew/my_app_v1" },
    })
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "My App" } })
}

beforeEach(() => {
    submitEnabled = true
    v3 = true
    adena = { connected: true, address: "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0", connect: vi.fn() }
    fetchByPublisher.mockReset().mockResolvedValue([])
    fetchRegistrationFee.mockReset().mockResolvedValue(1_000_000)
    doContractBroadcast.mockReset().mockResolvedValue({ hash: "0xabc" })
})

describe("AppSubmit — gates", () => {
    it("shows a not-open notice (no form) while VITE_ENABLE_APPSTORE_SUBMIT is off", () => {
        submitEnabled = false
        renderWithProviders(<AppSubmit />, { route: "/test13/apps/submit" })
        expect(screen.getByTestId("appsubmit-gated")).toBeInTheDocument()
        expect(screen.queryByLabelText(/package path/i)).not.toBeInTheDocument()
    })

    it("shows a v3-required notice (no form) while the active realm is v2", () => {
        v3 = false
        renderWithProviders(<AppSubmit />, { route: "/test13/apps/submit" })
        expect(screen.getByTestId("appsubmit-v2")).toBeInTheDocument()
        expect(screen.queryByLabelText(/package path/i)).not.toBeInTheDocument()
    })

    it("asks a disconnected visitor to connect instead of showing a dead form", () => {
        adena = { ...adena, connected: false, address: "" }
        renderWithProviders(<AppSubmit />, { route: "/test13/apps/submit" })
        expect(screen.getByRole("button", { name: /connect/i })).toBeInTheDocument()
        expect(screen.queryByLabelText(/package path/i)).not.toBeInTheDocument()
    })
})

describe("AppSubmit — fee disclosure (read live from the realm)", () => {
    it("shows the fee amount, treasury destination, and non-refundable warning before signing", async () => {
        renderWithProviders(<AppSubmit />, { route: "/test13/apps/submit" })
        const fee = await screen.findByTestId("appsubmit-fee")
        expect(fee.textContent).toMatch(/1 GNOT/)
        expect(fee.textContent).toMatch(/treasury/i)
        expect(fee.textContent).toMatch(/not refundable, including if rejected/i)
    })

    it("blocks submission when the fee can't be read (exact-coin: never guess)", async () => {
        fetchRegistrationFee.mockResolvedValue(null)
        renderWithProviders(<AppSubmit />, { route: "/test13/apps/submit" })
        fillRequired()
        await waitFor(() => expect(screen.getByTestId("appsubmit-submit")).toBeDisabled())
        expect(screen.getByTestId("appsubmit-fee-error")).toBeInTheDocument()
    })
})

describe("AppSubmit — validation mirrors the realm", () => {
    it("keeps submit disabled until the required fields are valid", async () => {
        renderWithProviders(<AppSubmit />, { route: "/test13/apps/submit" })
        await screen.findByTestId("appsubmit-fee")
        expect(screen.getByTestId("appsubmit-submit")).toBeDisabled()
        fillRequired()
        await waitFor(() => expect(screen.getByTestId("appsubmit-submit")).toBeEnabled())
    })

    it("rejects a non-allowlisted app URL scheme before any wallet prompt", async () => {
        renderWithProviders(<AppSubmit />, { route: "/test13/apps/submit" })
        await screen.findByTestId("appsubmit-fee")
        fillRequired()
        fireEvent.change(screen.getByLabelText(/app url/i), { target: { value: "javascript:alert(1)" } })
        expect(await screen.findByText(/must start with https:/i)).toBeInTheDocument()
        expect(screen.getByTestId("appsubmit-submit")).toBeDisabled()
    })
})

describe("AppSubmit — the money path", () => {
    it("broadcasts RegisterApp with the exact realm fee attached, then discloses the pending state", async () => {
        renderWithProviders(<AppSubmit />, { route: "/test13/apps/submit" })
        await screen.findByTestId("appsubmit-fee")
        fillRequired()
        await waitFor(() => expect(screen.getByTestId("appsubmit-submit")).toBeEnabled())
        fireEvent.click(screen.getByTestId("appsubmit-submit"))
        await waitFor(() => expect(doContractBroadcast).toHaveBeenCalledTimes(1))
        const [msgs] = doContractBroadcast.mock.calls[0]
        expect(msgs).toHaveLength(1)
        expect(msgs[0].value.func).toBe("RegisterApp")
        expect(msgs[0].value.send).toBe("1000000ugnot")
        expect(msgs[0].value.args[0]).toBe("gno.land/r/samcrew/my_app_v1")
        // Pending-state disclosure: the submitter must learn it is NOT live yet.
        expect(await screen.findByTestId("appsubmit-done")).toHaveTextContent(/pending review/i)
    })
})

describe("AppSubmit — my submissions (B5 lite)", () => {
    it("lists the caller's submissions with status, and the reject reason when rejected", async () => {
        fetchByPublisher.mockResolvedValue([
            mine({ pkgPath: "gno.land/r/samcrew/ok_v1", name: "OK App", status: "pending" }),
            mine({ id: 2, pkgPath: "gno.land/r/samcrew/bad_v1", name: "Bad App", status: "rejected", rejectReason: "broken link" }),
        ])
        renderWithProviders(<AppSubmit />, { route: "/test13/apps/submit" })
        expect(await screen.findByText("OK App")).toBeInTheDocument()
        expect(screen.getAllByText(/pending review/i).length).toBeGreaterThan(0)
        expect(screen.getByText("Bad App")).toBeInTheDocument()
        expect(screen.getByText(/broken link/)).toBeInTheDocument()
        expect(fetchByPublisher).toHaveBeenCalledWith(adena.address, 0, 50)
    })

    it("resubmits a rejected listing for free via EditListing (no coin attach)", async () => {
        fetchByPublisher.mockResolvedValue([
            mine({ pkgPath: "gno.land/r/samcrew/bad_v1", name: "Bad App", status: "rejected", rejectReason: "broken link" }),
        ])
        renderWithProviders(<AppSubmit />, { route: "/test13/apps/submit" })
        await screen.findByText("Bad App")
        fireEvent.click(screen.getByRole("button", { name: /fix & resubmit/i }))
        // The form is prefilled from the rejected listing and switches to the free edit path.
        const name = screen.getByLabelText(/^name/i) as HTMLInputElement
        expect(name.value).toBe("Bad App")
        await waitFor(() => expect(screen.getByTestId("appsubmit-submit")).toBeEnabled())
        fireEvent.click(screen.getByTestId("appsubmit-submit"))
        await waitFor(() => expect(doContractBroadcast).toHaveBeenCalledTimes(1))
        const [msgs] = doContractBroadcast.mock.calls[0]
        expect(msgs[0].value.func).toBe("EditListing")
        expect(msgs[0].value.send).toBe("")
        expect(msgs[0].value.args[0]).toBe("gno.land/r/samcrew/bad_v1")
    })
})

describe("AppSubmit — delist (one-way, armed confirm)", () => {
    it("arms a warning first, then broadcasts DelistApp and flips the row to Delisted", async () => {
        fetchByPublisher.mockResolvedValue([mine({ status: "live", name: "Mine" })])
        renderWithProviders(<AppSubmit />, { route: "/test13/apps/submit" })

        fireEvent.click(await screen.findByRole("button", { name: /^delist$/i }))
        // Nothing signed yet — the honest-contract warning is showing.
        expect(doContractBroadcast).not.toHaveBeenCalled()
        expect(screen.getByTestId("delist-confirm").textContent).toMatch(/only a curator can restore/i)
        expect(screen.getByTestId("delist-confirm").textContent).toMatch(/package path stays taken/i)

        fireEvent.click(screen.getByRole("button", { name: /yes, delist/i }))
        await waitFor(() => expect(doContractBroadcast).toHaveBeenCalledTimes(1))
        const [msgs] = doContractBroadcast.mock.calls[0]
        expect(msgs[0].value.func).toBe("DelistApp")
        expect(msgs[0].value.send).toBe("")
        expect(msgs[0].value.args).toEqual(["gno.land/r/samcrew/mine_v1"])
        // Optimistic flip: the row now reads Delisted and offers no further delist.
        await waitFor(() => expect(screen.getByText("Delisted")).toBeInTheDocument())
        expect(screen.queryByRole("button", { name: /^delist$/i })).not.toBeInTheDocument()
    })

    it("'Keep it' disarms without signing; delisted rows offer no delist button", async () => {
        fetchByPublisher.mockResolvedValue([
            mine({ status: "delisted" }),
            mine({ id: 2, pkgPath: "gno.land/r/samcrew/two_v1", name: "Two", status: "pending" }),
        ])
        renderWithProviders(<AppSubmit />, { route: "/test13/apps/submit" })
        // Only the pending row offers Delist (the delisted one can't go further).
        const btns = await screen.findAllByRole("button", { name: /^delist$/i })
        expect(btns).toHaveLength(1)
        fireEvent.click(btns[0])
        fireEvent.click(screen.getByRole("button", { name: /keep it/i }))
        expect(doContractBroadcast).not.toHaveBeenCalled()
        expect(screen.queryByTestId("delist-confirm")).not.toBeInTheDocument()
    })
})
