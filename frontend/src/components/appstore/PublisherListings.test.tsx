import { screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { renderWithProviders } from "../../test/test-utils"
import { PublisherListings } from "./PublisherListings"
import type { AppListing } from "../../lib/appStore"

const ADDR = "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"

function listing(over: Partial<AppListing>): AppListing {
    return {
        id: 1, pkgPath: "gno.land/r/samcrew/mine_v1", name: "Mine", tagline: "", category: "",
        iconCID: "", appURL: "", publisher: ADDR, status: "pending", flagCount: 0, createdAt: 0, ...over,
    }
}

const noop = () => {}
const base = {
    networkKey: "test13", onResubmit: noop, editLoading: null as string | null,
    delistArm: null as string | null, delistError: null as string | null,
    onArmDelist: noop, onConfirmDelist: noop, delisting: false,
}
const ROUTE = { route: "/test13/apps/my-submissions" }

describe("PublisherListings", () => {
    it("renders each listing's name + status, and the reject reason when rejected", () => {
        renderWithProviders(
            <PublisherListings {...base} list={[
                listing({ pkgPath: "gno.land/r/samcrew/ok_v1", name: "OK App", status: "pending" }),
                listing({ id: 2, pkgPath: "gno.land/r/samcrew/bad_v1", name: "Bad App", status: "rejected", rejectReason: "broken link" }),
            ]} />, ROUTE,
        )
        expect(screen.getByText("OK App")).toBeInTheDocument()
        expect(screen.getByText("Bad App")).toBeInTheDocument()
        expect(screen.getByText(/broken link/)).toBeInTheDocument()
    })

    it("offers Fix & resubmit for rejected / Edit for pending, reports edits remaining, and fires onResubmit", () => {
        const onResubmit = vi.fn()
        renderWithProviders(
            <PublisherListings {...base} onResubmit={onResubmit} list={[
                listing({ pkgPath: "gno.land/r/samcrew/bad_v1", name: "Bad App", status: "rejected", resubmitCount: 2 }),
            ]} />, ROUTE,
        )
        expect(screen.getByText(/3 edits left/i)).toBeInTheDocument() // 5 - 2
        fireEvent.click(screen.getByRole("button", { name: /fix & resubmit/i }))
        expect(onResubmit).toHaveBeenCalledTimes(1)
    })

    it("disables editing once the resubmit limit is reached", () => {
        renderWithProviders(
            <PublisherListings {...base} list={[listing({ status: "rejected", resubmitCount: 5 })]} />, ROUTE,
        )
        expect(screen.queryByRole("button", { name: /fix & resubmit/i })).not.toBeInTheDocument()
        expect(screen.getByText(/edit limit reached/i)).toBeInTheDocument()
    })

    it("surfaces the community flag count when a listing has reports", () => {
        renderWithProviders(
            <PublisherListings {...base} list={[listing({ status: "pending", flagCount: 3 })]} />, ROUTE,
        )
        expect(screen.getByTestId("publisher-flags")).toHaveTextContent("3")
    })

    it("links a live listing to its store page", () => {
        renderWithProviders(
            <PublisherListings {...base} list={[listing({ pkgPath: "gno.land/r/samcrew/live_v1", status: "live", name: "Live One" })]} />, ROUTE,
        )
        expect(screen.getByRole("link", { name: /view in store/i }))
            .toHaveAttribute("href", "/test13/apps/gno.land/r/samcrew/live_v1")
    })

    it("shows a loading state on the resubmit button while its detail is fetched", () => {
        renderWithProviders(
            <PublisherListings {...base} editLoading="gno.land/r/samcrew/bad_v1"
                list={[listing({ pkgPath: "gno.land/r/samcrew/bad_v1", status: "rejected" })]} />, ROUTE,
        )
        expect(screen.getByRole("button", { name: /loading/i })).toBeDisabled()
    })

    it("clicking Delist arms the confirmation via onArmDelist", () => {
        const onArmDelist = vi.fn()
        renderWithProviders(
            <PublisherListings {...base} onArmDelist={onArmDelist} list={[listing({ status: "live" })]} />, ROUTE,
        )
        fireEvent.click(screen.getByRole("button", { name: /^delist$/i }))
        expect(onArmDelist).toHaveBeenCalledWith("gno.land/r/samcrew/mine_v1")
    })

    it("when armed, shows the one-way warning and 'Yes, delist' fires onConfirmDelist", () => {
        const onConfirmDelist = vi.fn()
        renderWithProviders(
            <PublisherListings {...base} onConfirmDelist={onConfirmDelist}
                delistArm="gno.land/r/samcrew/mine_v1" list={[listing({ status: "live" })]} />, ROUTE,
        )
        expect(screen.getByTestId("delist-confirm").textContent).toMatch(/only a curator can restore/i)
        fireEvent.click(screen.getByRole("button", { name: /yes, delist/i }))
        expect(onConfirmDelist).toHaveBeenCalledWith("gno.land/r/samcrew/mine_v1")
    })
})
