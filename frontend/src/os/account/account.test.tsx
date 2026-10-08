import { installTestLocks } from "../../account/testLocks"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { useState, type ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AccountContext, SIGNED_OUT, type AccountApi } from "../../account/accountContext"

vi.mock("../../lib/config", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/config")>()), ACCOUNT_ENABLED: true }))
vi.mock("../../lib/accountApi", async (importOriginal) => {
    const real = await importOriginal<typeof import("../../lib/accountApi")>()
    return { ...real, accountApi: { get: vi.fn(), topics: vi.fn(), setTopic: vi.fn(), exportData: vi.fn(), remove: vi.fn(), confirm: vi.fn() } }
})
vi.mock("../../lib/monitoringAuth", () => ({ eraseMonitoringUser: vi.fn(async () => ({ ok: true })) }))
const { accountApi } = await import("../../lib/accountApi")
const { eraseMonitoringUser } = await import("../../lib/monitoringAuth")
const { AccountCard } = await import("./AccountCard")
const { EarlyAccess } = await import("./EarlyAccess")
const { ConfirmView } = await import("./ConfirmView")
const { resetDeletionForTests } = await import("./deletion")

const ADA = { id: "user_1", email: "ada@example.org", fullName: "Ada", isAdmin: false }
const off = [{ topic: "announcements", state: "off" }, { topic: "newsletter", state: "off" }, { topic: "early_access", state: "off" }]

function show(ui: ReactNode, account: Partial<AccountApi> = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const value: AccountApi = { ...SIGNED_OUT, available: true, ...account }
    return render(<QueryClientProvider client={client}><MemoryRouter><AccountContext.Provider value={value}>{ui}</AccountContext.Provider></MemoryRouter></QueryClientProvider>)
}
const signedIn = (extra: Partial<AccountApi> = {}): Partial<AccountApi> => ({ status: "ready", user: ADA, getToken: async () => "jwt", ...extra })

beforeEach(() => {
    installTestLocks()
    localStorage.clear()
    sessionStorage.clear()
    resetDeletionForTests()
    vi.mocked(accountApi.get).mockReset().mockResolvedValue({ id: "acc", email: "ada@example.org", emailVerifiedAt: "2026-10-08T00:00:00Z", createdAt: "2026-10-08T00:00:00Z" })
    vi.mocked(accountApi.topics).mockReset().mockResolvedValue(off as never)
    vi.mocked(accountApi.setTopic).mockReset().mockResolvedValue(off as never)
    vi.mocked(accountApi.remove).mockReset().mockResolvedValue(undefined)
    vi.mocked(accountApi.confirm).mockReset()
    vi.mocked(eraseMonitoringUser).mockReset().mockResolvedValue({ ok: true })
})

describe("Settings → Account", () => {
    it("asks a signed-out person to sign in only when they choose to, and reads nothing", () => {
        const openSignIn = vi.fn()
        show(<AccountCard />, { openSignIn })
        fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
        expect(openSignIn).toHaveBeenCalledOnce()
        expect(accountApi.get).not.toHaveBeenCalled()
        expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/os/privacy")
    })

    it("shows the verified address and asks for a topic with the wording version it showed", async () => {
        show(<AccountCard />, signedIn())
        expect(await screen.findByText("ada@example.org")).toBeInTheDocument()
        const newsletter = (await screen.findByText("Newsletter")).closest("li")!
        fireEvent.click(newsletter.querySelector("button")!)
        await waitFor(() => expect(accountApi.setTopic).toHaveBeenCalledWith("jwt", "newsletter", true, "settings", ""))
    })

    it("deletes step by step, never reads the account again once Memba's data is gone, and resumes a failed step", async () => {
        const deleteUser = vi.fn(async () => {})
        vi.mocked(eraseMonitoringUser).mockResolvedValueOnce({ ok: false })
        show(<AccountCard />, signedIn({ deleteUser }))
        await screen.findByText("ada@example.org")
        const reads = vi.mocked(accountApi.get).mock.calls.length
        fireEvent.click(screen.getByRole("button", { name: "Delete my account…" }))
        fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }))
        expect(await screen.findByRole("alert")).toHaveTextContent("Your Memba data is deleted, but your validator alerts could not be deleted yet.")
        expect(deleteUser).not.toHaveBeenCalled()
        // Coming back to the window refetches stale queries: the deleted account must not be read (it would come back).
        act(() => { focusManager.setFocused(false); focusManager.setFocused(true) })
        await new Promise((r) => setTimeout(r, 20))
        fireEvent.click(screen.getByRole("button", { name: "Try again" }))
        expect(await screen.findByText(/Your account is deleted/)).toBeInTheDocument()
        expect(accountApi.remove).toHaveBeenCalledOnce()
        expect(eraseMonitoringUser).toHaveBeenCalledTimes(2)
        expect(deleteUser).toHaveBeenCalledOnce()
        expect(accountApi.get).toHaveBeenCalledTimes(reads)
    })

    it("stops at Memba's step when it fails, with nothing deleted elsewhere", async () => {
        vi.mocked(accountApi.remove).mockRejectedValueOnce(new Error("down"))
        const deleteUser = vi.fn(async () => {})
        show(<AccountCard />, signedIn({ deleteUser }))
        await screen.findByText("ada@example.org")
        fireEvent.click(screen.getByRole("button", { name: "Delete my account…" }))
        fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }))
        expect(await screen.findByRole("alert")).toHaveTextContent("Account deletion is incomplete.")
        expect(eraseMonitoringUser).not.toHaveBeenCalled()
        expect(deleteUser).not.toHaveBeenCalled()
    })
})

describe("Settings → Account, deleting across windows and remounts", () => {
    it("keeps every reader paused after a failed later step: a remount and another window read nothing", async () => {
        vi.mocked(eraseMonitoringUser).mockResolvedValue({ ok: false })
        const deleteUser = vi.fn(async () => {})
        const view = show(<><AccountCard /><EarlyAccess app="nft" /></>, signedIn({ deleteUser }))
        await screen.findByText("ada@example.org")
        fireEvent.click(screen.getByRole("button", { name: "Delete my account…" }))
        fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }))
        await screen.findByRole("alert")
        const reads = vi.mocked(accountApi.get).mock.calls.length + vi.mocked(accountApi.topics).mock.calls.length
        view.unmount()
        show(<><AccountCard /><EarlyAccess app="launchpad" /></>, signedIn({ deleteUser }))
        expect(await screen.findByRole("alert")).toHaveTextContent("validator alerts could not be deleted yet")
        act(() => { focusManager.setFocused(false); focusManager.setFocused(true) })
        await new Promise((r) => setTimeout(r, 20))
        expect(vi.mocked(accountApi.get).mock.calls.length + vi.mocked(accountApi.topics).mock.calls.length).toBe(reads)
        expect(sessionStorage.getItem("memba_account_deletion")).toContain("alerts")
    })

    it("says when the download failed", async () => {
        vi.mocked(accountApi.exportData).mockRejectedValue(new Error("The account service answered 502."))
        show(<AccountCard />, signedIn())
        await screen.findByText("ada@example.org")
        fireEvent.click(screen.getByRole("button", { name: "Download my data" }))
        expect(await screen.findByRole("alert")).toHaveTextContent("Your data could not be downloaded: The account service answered 502.")
    })
})

describe("Early access", () => {
    it("asks to sign in at the step, then asks for the app alongside those already chosen", async () => {
        const openSignIn = vi.fn()
        const { unmount } = show(<EarlyAccess app="launchpad" />, { openSignIn })
        fireEvent.click(screen.getByRole("button", { name: "Sign in for early access" }))
        expect(openSignIn).toHaveBeenCalledOnce()
        unmount()
        vi.mocked(accountApi.topics).mockResolvedValue([...off.slice(0, 2), { topic: "early_access", state: "on", scope: "nft" }] as never)
        show(<EarlyAccess app="launchpad" />, signedIn())
        fireEvent.click(await screen.findByRole("button", { name: "Email me when it opens" }))
        await waitFor(() => expect(accountApi.setTopic).toHaveBeenCalledWith("jwt", "early_access", true, "early-access:launchpad", "nft,launchpad"))
    })

    it("says what is pending or on for the app", async () => {
        vi.mocked(accountApi.topics).mockResolvedValue([...off.slice(0, 2), { topic: "early_access", state: "pending", scope: "launchpad" }] as never)
        const { unmount } = show(<EarlyAccess app="launchpad" />, signedIn())
        expect(await screen.findByText(/confirm the email Memba sent you/)).toBeInTheDocument()
        unmount()
        vi.mocked(accountApi.topics).mockResolvedValue([...off.slice(0, 2), { topic: "early_access", state: "on", scope: "launchpad" }] as never)
        show(<EarlyAccess app="launchpad" />, signedIn())
        expect(await screen.findByText("You will get an email when Token Launchpad opens.")).toBeInTheDocument()
    })
})

describe("the confirmation page", () => {
    it("changes nothing when opened; Confirm confirms and says what", async () => {
        vi.mocked(accountApi.confirm).mockResolvedValue({ topic: "newsletter", state: "on" })
        show(<ConfirmView query="t=12.abc" forget={vi.fn()} />)
        expect(accountApi.confirm).not.toHaveBeenCalled()
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm" })) })
        expect(accountApi.confirm).toHaveBeenCalledWith("12.abc")
        expect(screen.getByRole("status")).toHaveTextContent("Confirmed: Memba will email you newsletter.")
    })

    it("takes the token out of the window's address at once, and still confirms with it", async () => {
        vi.mocked(accountApi.confirm).mockResolvedValue({ topic: "newsletter", state: "on" })
        const forget = vi.fn()
        // Stands in for Settings: forgetting rewrites the window's query.
        function Window() {
            const [query, setQuery] = useState("t=12.abc")
            return <ConfirmView query={query} forget={() => { forget(); setQuery("") }} />
        }
        show(<Window />)
        await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Confirm" })) })
        expect(accountApi.confirm).toHaveBeenCalledWith("12.abc")
        expect(forget).toHaveBeenCalledOnce()
    })

    it("shows the service's refusal, and says an incomplete link is incomplete", async () => {
        vi.mocked(accountApi.confirm).mockRejectedValue(new Error("This link was already used, or the request it confirms is no longer open."))
        const { unmount } = show(<ConfirmView query="t=12.abc" forget={vi.fn()} />)
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm" })) })
        expect(screen.getByRole("alert")).toHaveTextContent("already used")
        unmount()
        show(<ConfirmView query="" forget={vi.fn()} />)
        expect(screen.getByText(/This link is incomplete/)).toBeInTheDocument()
    })
})
