import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import ClerkProvider from "../components/auth/ClerkProvider"
import AlertsPage from "./AlertsPage"

// The test build sets no VITE_CLERK_PUBLISHABLE_KEY, like memba.club before its Clerk setup.
describe("without a Clerk key", () => {
    it("renders the caller's fallback, or nothing, instead of Clerk", () => {
        const { container, rerender } = render(<ClerkProvider fallback={<p>fallback</p>}><p>signed area</p></ClerkProvider>)
        expect(screen.getByText("fallback")).toBeInTheDocument()
        expect(screen.queryByText("signed area")).not.toBeInTheDocument()
        rerender(<ClerkProvider><p>signed area</p></ClerkProvider>)
        expect(container).toBeEmptyDOMElement()
    })

    it("says on the Alerts page that alerts can't be set up here, and keeps the public Telegram bots", async () => {
        render(<AlertsPage />)
        expect(await screen.findByText("Sign-in for alerts isn't available on this site yet, so alerts can't be set up here.")).toHaveAttribute("role", "status")
        expect(screen.queryByText(/VITE_CLERK_PUBLISHABLE_KEY|not configured/)).not.toBeInTheDocument()
        expect(screen.getByText("Telegram Bots")).toBeInTheDocument()
    })
})
