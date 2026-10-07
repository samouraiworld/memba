import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AccountContext, SIGNED_OUT, type AccountApi } from "../account/accountContext"
import AlertsPage from "./AlertsPage"

vi.mock("../lib/monitoringAuth", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../lib/monitoringAuth")>()),
    ensureMonitoringUser: vi.fn(async () => {}),
    listAlertContacts: vi.fn(async () => []),
    getReportSchedule: vi.fn(async () => null),
    listWebhooks: vi.fn(async () => []),
}))
const monitoring = await import("../lib/monitoringAuth")

const withAccount = (account: Partial<AccountApi>) =>
    render(<AccountContext.Provider value={{ ...SIGNED_OUT, available: true, ...account }}><AlertsPage /></AccountContext.Provider>)

// The test build sets no VITE_CLERK_PUBLISHABLE_KEY, like memba.club before its Clerk setup.
describe("the Alerts page", () => {
    it("says alerts can't be set up without a Clerk key, and keeps the public Telegram bots", async () => {
        render(<AlertsPage />)
        expect(await screen.findByText("Sign-in for alerts isn't available on this site yet, so alerts can't be set up here.")).toHaveAttribute("role", "status")
        expect(screen.queryByText(/VITE_CLERK_PUBLISHABLE_KEY|not configured/)).not.toBeInTheDocument()
        expect(screen.getByText("Telegram Bots")).toBeInTheDocument()
    })

    it("says sign-in is unavailable when Clerk did not load", () => {
        withAccount({ status: "failed" })
        expect(screen.getByText("Sign-in is unavailable right now. Try again later.")).toHaveAttribute("role", "status")
    })

    it("asks a signed-out person to sign in, and opens Clerk only on that click", () => {
        const openSignIn = vi.fn()
        withAccount({ openSignIn })
        expect(openSignIn).not.toHaveBeenCalled()
        screen.getByRole("button", { name: "Sign in to configure alerts" }).click()
        expect(openSignIn).toHaveBeenCalledOnce()
    })

    it("provisions the gnomonitoring user here, when the alert settings open signed in", async () => {
        withAccount({ status: "ready", user: { id: "user_1", email: "ada@example.org", fullName: "Ada", isAdmin: false }, getToken: async () => "jwt" })
        await waitFor(() => expect(monitoring.ensureMonitoringUser).toHaveBeenCalledWith("jwt", "Ada", "ada@example.org"))
        expect(monitoring.listWebhooks).toHaveBeenCalledWith("jwt", "validator")
    })
})
