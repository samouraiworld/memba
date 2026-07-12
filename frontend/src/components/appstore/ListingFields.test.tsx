import { useState } from "react"
import { screen, fireEvent } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { renderWithProviders } from "../../test/test-utils"
import { ListingFields } from "./ListingFields"
import { validateSubmission, type AppSubmission } from "../../lib/appStoreSubmit"

const EMPTY: AppSubmission = {
    pkgPath: "", name: "", tagline: "", descr: "", category: "", iconCID: "", screenshotsCSV: "", appURL: "",
}

/** ListingFields is controlled — wrap it with local state so typing round-trips. */
function Harness({ initial = EMPTY, authed = true, pkgPathDisabled = false }: {
    initial?: AppSubmission; authed?: boolean; pkgPathDisabled?: boolean
}) {
    const [form, setForm] = useState(initial)
    return (
        <ListingFields form={form} setForm={setForm} errors={validateSubmission(form)}
            authed={authed} pkgPathDisabled={pkgPathDisabled} />
    )
}
const ROUTE = { route: "/test13/apps/submit" }

describe("ListingFields", () => {
    it("renders every listing field seeded from the form", () => {
        renderWithProviders(
            <Harness initial={{ ...EMPTY, pkgPath: "gno.land/r/samcrew/x_v1", name: "My App", descr: "Desc" }} />, ROUTE)
        expect((screen.getByLabelText(/package path/i) as HTMLInputElement).value).toBe("gno.land/r/samcrew/x_v1")
        expect((screen.getByLabelText(/^name/i) as HTMLInputElement).value).toBe("My App")
        expect((screen.getByLabelText(/description/i) as HTMLTextAreaElement).value).toBe("Desc")
    })

    it("is controlled — edits round-trip through setForm", () => {
        renderWithProviders(<Harness />, ROUTE)
        fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Renamed" } })
        expect((screen.getByLabelText(/^name/i) as HTMLInputElement).value).toBe("Renamed")
    })

    it("disables the package path when pkgPathDisabled (the immutable listing key in edit mode)", () => {
        renderWithProviders(
            <Harness pkgPathDisabled initial={{ ...EMPTY, pkgPath: "gno.land/r/samcrew/x_v1" }} />, ROUTE)
        expect(screen.getByLabelText(/package path/i)).toBeDisabled()
    })

    it("surfaces the artwork sign-in prerequisite when unauthenticated", () => {
        renderWithProviders(<Harness authed={false} />, ROUTE)
        expect(screen.getByTestId("appsubmit-art-authnote")).toBeInTheDocument()
    })
})
