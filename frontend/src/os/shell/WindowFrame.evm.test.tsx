import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { NativeViewProps } from "../native/types"
import type { OsSession } from "./useOsSession"
import type { OsWindow } from "./windows"
import type { OsTarget } from "./osPath"
import { WindowBody } from "./WindowFrame"
import { switchOsNetwork } from "./network"

vi.mock("../../lib/chain/flag", () => ({ EVM_ENABLED: true }))
vi.mock("./network", async (importOriginal) => ({ ...(await importOriginal<typeof import("./network")>()), switchOsNetwork: vi.fn() }))
vi.mock("../native/registry", () => ({
    nativeView: (app: string) => app === "settings" ? ({ fallback }: NativeViewProps) => <div data-testid="native">{fallback}</div> : undefined,
}))
vi.mock("../page/ClassicPage", () => ({ ClassicPage: () => <div>classic page</div> }))
vi.mock("../multisig/evm/SafeWindows", () => ({
    SafeApp: () => <div>safe app</div>,
    SafeWindow: ({ address }: { address: string }) => <div>safe window {address}</div>,
}))
vi.mock("../multisig/evm/ImportSafe", () => ({ ImportSafe: () => <div>import safe</div> }))
vi.mock("../multisig/MultisigWindows", () => ({ MultisigApp: () => <div>gno multisig app</div>, MultisigWindow: () => <div>gno multisig window</div> }))

afterEach(() => vi.clearAllMocks())

const onBase = { status: "guest", network: { key: "base-sepolia", family: "evm", label: "Base Sepolia" }, layout: {}, openConnect: vi.fn() } as unknown as OsSession
const onGno = { status: "member", network: { key: "mainnet", family: "gno", label: "gno.land" }, layout: {}, openConnect: vi.fn() } as unknown as OsSession

function show(target: OsTarget, session: OsSession) {
    const win: OsWindow = { id: "w1", key: "k", title: "t", app: target.kind === "app" ? target.app : null, x: 0, y: 0, width: 600, height: 400, z: 1, min: false, max: false, target }
    render(<MemoryRouter><WindowBody win={win} session={session} open={vi.fn()} openApp={vi.fn()} close={vi.fn()} toast={vi.fn()} /></MemoryRouter>)
}

describe("WindowBody on an EVM network", () => {
    it("shows a gno.land-only app as such, with a way back to gno.land, never its classic page", async () => {
        show({ kind: "app", app: "validators", section: null }, onBase)
        expect(screen.getByText("Validators runs on gno.land")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Switch to gno.land" }))
        expect(switchOsNetwork).toHaveBeenCalledTimes(1)
        expect(screen.queryByText("classic page")).toBeNull()
    })

    it("does the same for DAO folders", () => {
        show({ kind: "dao", name: "govdao", section: null }, onBase)
        expect(screen.getByText("DAOs runs on gno.land")).toBeInTheDocument()
    })

    it("does the same for the feedback window", () => {
        show({ kind: "feedback" }, onBase)
        expect(screen.getByText("Feedback runs on gno.land")).toBeInTheDocument()
        expect(screen.queryByText("classic page")).toBeNull()
    })

    it("opens an app that runs on EVM in its native view, whose fallback is never a classic page", async () => {
        show({ kind: "app", app: "settings", section: "unknown-pane" }, onBase)
        const native = await screen.findByTestId("native")
        expect(native).toHaveTextContent("This page runs on gno.land")
        expect(screen.queryByText("classic page")).toBeNull()
    })

    it("leaves gno.land windows as they are", async () => {
        show({ kind: "app", app: "validators", section: null }, onGno)
        expect(await screen.findByText("classic page")).toBeInTheDocument()
        expect(screen.queryByText(/runs on gno.land/)).toBeNull()
    })

    it("opens Multisig as the Safe app, and a 0x address as a Safe window", async () => {
        show({ kind: "app", app: "multisig", section: null }, onBase)
        expect(await screen.findByText("safe app")).toBeInTheDocument()
        expect(screen.queryByText("gno multisig app")).toBeNull()
    })

    it("opens a Safe window for an EVM address, and names a gno.land multisig as such", async () => {
        show({ kind: "multisig", address: "0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe" }, onBase)
        expect(await screen.findByText("safe window 0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe")).toBeInTheDocument()
    })

    it("says a gno.land multisig address doesn't exist on the EVM network", () => {
        show({ kind: "multisig", address: "g103kjrkw6l0a9le0a0q0dsgy0uyt4jyha55cd4l" }, onBase)
        expect(screen.getByText("This is a gno.land multisig")).toBeInTheDocument()
        expect(screen.queryByText(/gno multisig window/)).toBeNull()
    })

    it("opens the Safe import window for Multisig's import page", async () => {
        show({ kind: "app", app: "multisig", section: "import" }, onBase)
        expect(await screen.findByText("import safe")).toBeInTheDocument()
    })

    it("holds the Multisig pages not built for Safes yet, never their gno.land page", () => {
        show({ kind: "app", app: "multisig", section: "create" }, onBase)
        expect(screen.getByText("Coming next")).toBeInTheDocument()
        expect(screen.queryByText("classic page")).toBeNull()
    })

    it("keeps the gno.land Multisig windows on gno.land", async () => {
        show({ kind: "app", app: "multisig", section: null }, onGno)
        expect(await screen.findByText("gno multisig app")).toBeInTheDocument()
    })

    it("welcomes a visitor to the EVM network without offering gno.land apps", () => {
        const win: OsWindow = { id: "w0", key: "welcome", title: "Welcome", app: null, x: 0, y: 0, width: 600, height: 400, z: 1, min: false, max: false, target: { kind: "desktop" } }
        render(<MemoryRouter><WindowBody win={win} session={onBase} open={vi.fn()} openApp={vi.fn()} close={vi.fn()} toast={vi.fn()} /></MemoryRouter>)
        expect(screen.getByText("Memba on Base Sepolia")).toBeInTheDocument()
        expect(screen.queryByText("Explore DAOs")).toBeNull()
        expect(screen.getByRole("button", { name: "Switch to gno.land" })).toBeInTheDocument()
    })
})
