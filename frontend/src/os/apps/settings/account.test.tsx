import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"
import { AppearanceContext, type OsAppearance } from "../../appearance"
import type { NativeViewProps } from "../../native/types"
import { AccountContext, SIGNED_OUT } from "../../../account/accountContext"

vi.mock("../../../lib/config", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../../lib/config")>()), ACCOUNT_ENABLED: true }))
vi.mock("../../../components/alerts/AlertsPanel", () => ({ default: () => null }))
const { default: SettingsWindow } = await import("./native")
const { targetsFromUrl, saveWindows, windowsStorageKey } = await import("../../shell/urlSync")

const session = { status: "guest", address: "", network: { key: "gnoland1", label: "Mainnet", chainId: "gnoland-1", rpcHost: "rpc.gno.land", isTestnet: false }, openConnect: vi.fn() } as unknown as NativeViewProps["session"]

function show(section: string, query = "") {
    const appearance = { themePref: "system", theme: "dark", wallpaper: "aurora", iconSize: "md", setThemePref: vi.fn(), setWallpaper: vi.fn(), setIconSize: vi.fn() } as unknown as OsAppearance
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><AppearanceContext.Provider value={appearance}><AccountContext.Provider value={{ ...SIGNED_OUT, available: true }}>
        <SettingsWindow section={section} query={query} session={session} active open={vi.fn()} push={vi.fn()} openApp={vi.fn()} close={vi.fn()} toast={vi.fn()} fallback={<p>classic page</p>} />
    </AccountContext.Provider></AppearanceContext.Provider></MemoryRouter></QueryClientProvider>)
}

describe("Settings with the optional account on", () => {
    it("has a Privacy pane", () => {
        show("privacy")
        expect(screen.getByRole("button", { name: "Privacy" })).toHaveAttribute("aria-current", "true")
        expect(screen.getByRole("heading", { name: "Privacy" })).toBeInTheDocument()
        expect(screen.getByRole("link", { name: "support@samourai.coop" })).toHaveAttribute("href", "mailto:support@samourai.coop")
    })

    it("opens a confirmation link on Account, with its token, and the account card below", () => {
        const { front } = targetsFromUrl("/os/confirm", "?t=12.abc")
        expect(front).toEqual({ kind: "app", app: "settings", section: "confirm", query: "t=12.abc" })
        expect(targetsFromUrl("/os/privacy", "").front).toEqual({ kind: "app", app: "settings", section: "privacy", query: "" })
        show("confirm", "t=12.abc")
        expect(screen.getByRole("button", { name: "Account" })).toHaveAttribute("aria-current", "true")
        expect(screen.getByRole("heading", { name: "Confirm your email" })).toBeInTheDocument()
        expect(screen.getByRole("heading", { name: "Memba account (optional)" })).toBeInTheDocument()
    })

    it("never saves a confirmation link's token with the window", () => {
        const win = { id: "w1", key: "app:settings", title: "Settings", app: "settings", x: 0, y: 0, width: 600, height: 400, z: 1, min: false, max: false,
            target: { kind: "app", app: "settings", section: "confirm", query: "t=12.abc" } } as const
        saveWindows([win])
        expect(localStorage.getItem(windowsStorageKey())).not.toContain("12.abc")
    })
})
