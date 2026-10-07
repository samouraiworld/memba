import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AppearanceContext, type OsAppearance } from "../../appearance"
import type { NativeViewProps } from "../../native/types"
import type { WindowSpec } from "../../shell/windows"
import SettingsWindow from "./native"

vi.mock("../../../components/alerts/AlertsPanel", () => ({ default: ({ embedded }: { embedded?: boolean }) => <p>alerts panel{embedded ? " (embedded)" : ""}</p> }))

const session = { status: "guest", address: "", network: { key: "gnoland1", label: "Mainnet", chainId: "gnoland-1", rpcHost: "rpc.gno.land", isTestnet: false }, openConnect: vi.fn() } as unknown as NativeViewProps["session"]

function show(section: string | null, open = vi.fn<(spec: WindowSpec) => void>()) {
    const appearance = { themePref: "system", theme: "dark", wallpaper: "aurora", iconSize: "md", setThemePref: vi.fn(), setWallpaper: vi.fn(), setIconSize: vi.fn() } as unknown as OsAppearance
    render(<AppearanceContext.Provider value={appearance}>
        <SettingsWindow section={section} session={session} active open={open} push={vi.fn()} openApp={vi.fn()} close={vi.fn()} toast={vi.fn()} fallback={<p>classic page</p>} />
    </AppearanceContext.Provider>)
    return open
}

describe("Settings · Notifications", () => {
    it("opens Notifications for the classic /alerts address, with the alerts panel loaded there", async () => {
        show("alerts")
        expect(screen.getByRole("button", { name: "Notifications" })).toHaveAttribute("aria-current", "true")
        expect(screen.getByRole("heading", { name: "Validators and GovDAO alerts" })).toBeInTheDocument()
        expect(await screen.findByText("alerts panel (embedded)")).toBeInTheDocument()
    })

    it("does not load the alerts panel on another pane", () => {
        show("safety")
        expect(screen.queryByText(/alerts panel/)).toBeNull()
    })

    it("makes a pane the window's address, so a later link to Notifications shows it again", () => {
        const open = show("notifications")
        fireEvent.click(screen.getByRole("button", { name: "Safety" }))
        expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ target: { kind: "app", app: "settings", section: "safety" } }))
    })
})

describe("Settings · Network", () => {
    it("names Adena while the EVM network is off", () => {
        show("network")
        expect(screen.getByText(/may require reconnecting Adena/)).toBeInTheDocument()
    })

    it("names no wallet brand once Base can be selected", async () => {
        vi.resetModules()
        vi.doMock("../../../lib/chain/flag", () => ({ EVM_ENABLED: true }))
        const { default: EvmSettings } = await import("./native")
        const { AppearanceContext: Ctx } = await import("../../appearance")
        const appearance = { themePref: "system", theme: "dark", wallpaper: "aurora", iconSize: "md", setThemePref: vi.fn(), setWallpaper: vi.fn(), setIconSize: vi.fn() } as unknown as OsAppearance
        render(<Ctx.Provider value={appearance}>
            <EvmSettings section="network" session={session} active open={vi.fn()} push={vi.fn()} openApp={vi.fn()} close={vi.fn()} toast={vi.fn()} fallback={<p>classic page</p>} />
        </Ctx.Provider>)
        expect(screen.getByText(/may require reconnecting your wallet/)).toBeInTheDocument()
        expect(screen.queryByText(/Adena/)).toBeNull()
        vi.doUnmock("../../../lib/chain/flag")
    })
})
