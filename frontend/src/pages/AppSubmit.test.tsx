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
const fetchApp = vi.fn()
const fetchRegistrationFee = vi.fn()
const doContractBroadcast = vi.fn()
const uploadImage = vi.fn()

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
        fetchApp: (...a: unknown[]) => fetchApp(...a),
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
// Keep the REAL isValidImageMime (the uploader's client-side reject must be exercised);
// only stub the network-touching uploadImage.
vi.mock("../lib/ipfs", async (importActual) => {
    const actual = await importActual<typeof import("../lib/ipfs")>()
    return { ...actual, uploadImage: (...a: unknown[]) => uploadImage(...a) }
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
    fetchApp.mockReset().mockResolvedValue(null)
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
        const row = mine({ pkgPath: "gno.land/r/samcrew/bad_v1", name: "Bad App", status: "rejected", rejectReason: "broken link" })
        fetchByPublisher.mockResolvedValue([row])
        // The edit form seeds from full on-chain detail (GetListingJSON), not the list-window row.
        fetchApp.mockResolvedValue({ ...row, descr: "Full description.", screenshotCIDs: [] })
        renderWithProviders(<AppSubmit />, { route: "/test13/apps/submit" })
        await screen.findByText("Bad App")
        fireEvent.click(screen.getByRole("button", { name: /fix & resubmit/i }))
        // The form is prefilled from the rejected listing and switches to the free edit path.
        const name = screen.getByLabelText(/^name/i) as HTMLInputElement
        await waitFor(() => expect(name.value).toBe("Bad App"))
        await waitFor(() => expect(screen.getByTestId("appsubmit-submit")).toBeEnabled())
        fireEvent.click(screen.getByTestId("appsubmit-submit"))
        await waitFor(() => expect(doContractBroadcast).toHaveBeenCalledTimes(1))
        const [msgs] = doContractBroadcast.mock.calls[0]
        expect(msgs[0].value.func).toBe("EditListing")
        expect(msgs[0].value.send).toBe("")
        expect(msgs[0].value.args[0]).toBe("gno.land/r/samcrew/bad_v1")
    })

    it("seeds the resubmit form from full on-chain detail so EditListing can't wipe descr + screenshots", async () => {
        // ListByPublisherJSON (the My-Submissions list window) omits descr + screenshots, but
        // EditListing overwrites EVERY field. Seeding the form from the list row would blank the
        // description and screenshots on-chain — the form MUST come from GetListingJSON (full detail).
        const row = mine({ pkgPath: "gno.land/r/samcrew/bad_v1", name: "Bad App", status: "rejected" })
        fetchByPublisher.mockResolvedValue([row])
        fetchApp.mockResolvedValue({
            ...row,
            descr: "The full description the curator needs.",
            iconCID: "bafyicon",
            screenshotCIDs: ["bafyshot1", "bafyshot2"],
        })
        renderWithProviders(<AppSubmit />, { route: "/test13/apps/submit" })
        await screen.findByText("Bad App")
        fireEvent.click(screen.getByRole("button", { name: /fix & resubmit/i }))
        // The description textarea is populated from full detail, not left blank.
        await waitFor(() =>
            expect((screen.getByLabelText(/description/i) as HTMLTextAreaElement).value)
                .toBe("The full description the curator needs."))
        await waitFor(() => expect(screen.getByTestId("appsubmit-submit")).toBeEnabled())
        fireEvent.click(screen.getByTestId("appsubmit-submit"))
        await waitFor(() => expect(doContractBroadcast).toHaveBeenCalledTimes(1))
        // wireArgs order: [pkgPath, name, tagline, descr, category, iconCID, screenshotsCSV, appURL]
        const args = (doContractBroadcast.mock.calls[0][0] as { value: { args: string[] } }[])[0].value.args
        expect(args[3]).toBe("The full description the curator needs.") // descr preserved
        expect(args[5]).toBe("bafyicon")                                 // icon preserved
        expect(args[6]).toBe("bafyshot1,bafyshot2")                      // screenshots preserved
    })

    it("aborts the resubmit with an error (no data-losing edit) when full detail can't be loaded", async () => {
        fetchByPublisher.mockResolvedValue([
            mine({ pkgPath: "gno.land/r/samcrew/bad_v1", name: "Bad App", status: "rejected" }),
        ])
        fetchApp.mockResolvedValue(null) // transient read failure
        renderWithProviders(<AppSubmit />, { route: "/test13/apps/submit" })
        await screen.findByText("Bad App")
        fireEvent.click(screen.getByRole("button", { name: /fix & resubmit/i }))
        // Surfaces an error and does NOT enter edit mode with blanked fields.
        expect(await screen.findByText(/couldn't load/i)).toBeInTheDocument()
        expect(screen.queryByText(/resubmitting is free/i)).not.toBeInTheDocument()
        expect(doContractBroadcast).not.toHaveBeenCalled()
    })

    it("shows a loading state on the resubmit button while full detail is fetched", async () => {
        let resolveFetch!: (v: AppListing) => void
        fetchApp.mockReturnValue(new Promise((r) => { resolveFetch = r }))
        const row = mine({ pkgPath: "gno.land/r/samcrew/bad_v1", name: "Bad App", status: "rejected" })
        fetchByPublisher.mockResolvedValue([row])
        renderWithProviders(<AppSubmit />, { route: "/test13/apps/submit" })
        await screen.findByText("Bad App")
        fireEvent.click(screen.getByRole("button", { name: /fix & resubmit/i }))
        // While the fetch is in-flight the button shows a loading label and is disabled (no double-fetch).
        expect(await screen.findByRole("button", { name: /loading/i })).toBeDisabled()
        resolveFetch({ ...row, descr: "d", screenshotCIDs: [] })
        await waitFor(() => expect(screen.getByLabelText(/^name/i)).toHaveValue("Bad App"))
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

    it("a failed delist shows the error in the confirm box and stays armed for retry", async () => {
        doContractBroadcast.mockRejectedValueOnce(new Error("network exploded"))
        fetchByPublisher.mockResolvedValue([mine({ status: "live", name: "Mine" })])
        renderWithProviders(<AppSubmit />, { route: "/test13/apps/submit" })
        fireEvent.click(await screen.findByRole("button", { name: /^delist$/i }))
        fireEvent.click(screen.getByRole("button", { name: /yes, delist/i }))
        // Error renders INSIDE the still-armed confirm box (review F-1: the
        // page-level txError is invisible once the done panel shows).
        await waitFor(() =>
            expect(screen.getByTestId("delist-confirm").textContent).toMatch(/didn't go through/i)
        )
        expect(screen.getByRole("button", { name: /yes, delist/i })).toBeEnabled()
        expect(screen.queryByText("Delisted")).not.toBeInTheDocument()
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

describe("AppSubmit — artwork uploaders (B6, bare CID → wireArgs)", () => {
    const AUTHED = JSON.stringify({
        userAddress: "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0",
        nonce: "n", expiration: "2999-01-01T00:00:00Z", serverSignature: "s",
    })
    beforeEach(() => {
        uploadImage.mockReset()
        localStorage.setItem("memba_auth_token", AUTHED) // backend-auth prerequisite met
    })
    afterEach(() => { localStorage.clear() })

    // wireArgs order: [pkgPath, name, tagline, descr, category, iconCID, screenshotsCSV, appURL]
    function argsOf(): string[] {
        return (doContractBroadcast.mock.calls[0][0] as { value: { args: string[] } }[])[0].value.args
    }

    it("pins an icon and threads its BARE CID through RegisterApp (index 5)", async () => {
        const ICON = "bafybei" + "i".repeat(52)
        uploadImage.mockResolvedValue(ICON)
        renderWithProviders(<AppSubmit />, { route: "/test13/apps/submit" })
        await screen.findByTestId("appsubmit-fee")
        fillRequired()

        fireEvent.change(screen.getByTestId("appsubmit-icon-input"), {
            target: { files: [new File(["icon"], "icon.png", { type: "image/png" })] },
        })
        await screen.findByTestId("appsubmit-icon-current") // form.iconCID now set

        fireEvent.click(screen.getByTestId("appsubmit-submit"))
        await waitFor(() => expect(doContractBroadcast).toHaveBeenCalled())
        const args = argsOf()
        expect(args[5]).toBe(ICON)
        expect(args[5].startsWith("ipfs://")).toBe(false)
        expect(args[5].startsWith("http")).toBe(false)
    })

    it("adds a screenshot as a BARE CID into the screenshots CSV (index 6)", async () => {
        const SHOT = "bafybei" + "s".repeat(52)
        uploadImage.mockResolvedValue(SHOT)
        renderWithProviders(<AppSubmit />, { route: "/test13/apps/submit" })
        await screen.findByTestId("appsubmit-fee")
        fillRequired()

        fireEvent.change(screen.getByTestId("appsubmit-shot-input"), {
            target: { files: [new File(["shot"], "shot.png", { type: "image/png" })] },
        })
        await screen.findByTestId("appsubmit-shots")

        fireEvent.click(screen.getByTestId("appsubmit-submit"))
        await waitFor(() => expect(doContractBroadcast).toHaveBeenCalled())
        expect(argsOf()[6]).toBe(SHOT)
    })

    it("surfaces the sign-in prerequisite and disables the picker when unauthenticated", async () => {
        localStorage.removeItem("memba_auth_token")
        renderWithProviders(<AppSubmit />, { route: "/test13/apps/submit" })
        await screen.findByTestId("appsubmit-fee")
        expect(screen.getByTestId("appsubmit-art-authnote")).toBeInTheDocument()
        expect(screen.getByTestId("appsubmit-icon-choose")).toBeDisabled()
        expect(uploadImage).not.toHaveBeenCalled()
    })
})
