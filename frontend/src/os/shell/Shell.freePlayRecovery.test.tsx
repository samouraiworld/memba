/** Real Shell/SignerProvider/window restoration with a lifecycle probe instead of a game engine.
 * These tests document expected remounts; browser/real-engine preservation is a separate recipe.
 */
import { useEffect, useState, type ReactNode } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Shell } from "./Shell"
import type { OsSession } from "./useOsSession"
import { appSpec, EMPTY_WINDOWS, windowsReducer, type OsWindow } from "./windows"
import { saveWindows } from "./urlSync"
import ArcadeWindow from "../apps/arcade/native"
import { createFreePlaySnapshot, loadFreePlaySnapshot, saveFreePlaySnapshot } from "../../games/arcade/freeplay/snapshot"
import type { ArcadeFreePlayConfiguration } from "../../games/arcade/freeplay/runtimeConfiguration"
import type { FreePlayInput } from "../../lib/arcadeFreePlay"
import vectors from "../../games/arcade/freeplay/vectors.json"

const fixture = vi.hoisted(() => ({ session: null as unknown as OsSession, mounts: 0, unmounts: 0 }))
vi.mock("./useOsSession", () => ({ useOsSession: () => fixture.session }))
vi.mock("../../lib/chain/flag", () => ({ EVM_ENABLED: false }))
vi.mock("../../lib/notes/config", () => ({ NOTES_ENABLED: false, notesDeployment: () => null }))
vi.mock("../preferences", () => ({ readSkipIntro: () => true, useLiveWidget: () => false }))
vi.mock("../boot/boot", () => ({ shouldBoot: () => false, bootLines: () => [] }))
vi.mock("./useDesk", () => ({ useDesk: () => ({ items: [], resetFromStorage: () => {}, isPinned: () => false }) }))
vi.mock("./ConnectModal", () => ({ ConnectModal: () => null }))
vi.mock("../evm/EvmConnectModal", () => ({ EvmConnectModal: () => null }))
vi.mock("./DeskItems", () => ({ DeskItems: () => null, ContextMenu: () => null }))
vi.mock("./Dock", () => ({ Dock: () => null }))
vi.mock("./Launcher", () => ({ Launcher: () => null }))
vi.mock("../community/CommunityNews", () => ({ CommunityNewsPrompt: () => null }))
vi.mock("../apps/live/LiveProvider", () => ({ LiveActivityProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock("../apps/meet/MeetStage", () => ({ MeetStage: () => null }))
vi.mock("../apps/notes/NotesStages", () => ({ NotesStages: () => null }))
vi.mock("../apps/notes/stageRegistry", () => ({ NotesStageProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock("../kit/storefront", async original => ({
    ...(await original<typeof import("../kit/storefront")>()), useReviewSummaries: () => new Map(),
}))
vi.mock("./MenuBar", () => ({ MenuBar: ({ openSpec }: { openSpec: (spec: ReturnType<typeof appSpec>) => void }) =>
    <button onClick={() => openSpec(appSpec("arcade", "runs"))}>Open saved results</button> }))
vi.mock("./WindowFrame", () => ({ WindowFrame: ProbeWindow }))

function ProbeWindow({ win, session, open, openApp, toast }: {
    win: OsWindow; session: OsSession; open: (spec: ReturnType<typeof appSpec>) => void; openApp: () => void; toast: () => void
}) {
    const [instance] = useState(() => ++fixture.mounts)
    useEffect(() => () => { fixture.unmounts++ }, [])
    if (win.target?.kind === "app" && win.target.app === "arcade" && win.target.section === "runs") {
        return <ArcadeWindow section="runs" open={open} push={open} openApp={openApp} close={() => {}} toast={toast}
            session={session} fallback={null} active />
    }
    return <output data-testid={win.key} data-instance={instance}>{win.key}</output>
}

const desk = { w: 1200, h: 760 }
const input = { ...vectors.runs[0].input, claimedScore: vectors.runs[0].score } as FreePlayInput
function seedDesk(owner: string, section: string | null) {
    const state = section === null ? EMPTY_WINDOWS : windowsReducer(EMPTY_WINDOWS, { type: "open", spec: appSpec("arcade", section), desk })
    saveWindows(state.wins, owner)
}
function identity(address?: string): OsSession {
    return { status: address ? "member" : "guest", address: address ?? "", walletAddress: address ?? "", walletChainId: "gnoland-1",
        network: { key: "mainnet", chainId: "gnoland-1", family: "gno", isTestnet: false }, layout: { auth: null },
        stage: null, openConnect: vi.fn(), disconnect: vi.fn(), wake: vi.fn() } as unknown as OsSession
}
function mountShell(path = "/os") {
    const query = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const configuration: ArcadeFreePlayConfiguration = { chainId: "gnoland-1", storage: localStorage,
        games: { "block-party": { rules: "bp-free-standard-undo-v1", simVersion: 1 } } }
    const tree = () => <QueryClientProvider client={query}><MemoryRouter initialEntries={[path]}>
        <Shell freePlayConfiguration={configuration} />
    </MemoryRouter></QueryClientProvider>
    const view = render(tree())
    return { ...view, changeOwner: (address: string) => { fixture.session = identity(address); view.rerender(tree()) } }
}
function reopenCanonicalResult() {
    fireEvent.click(screen.getByRole("button", { name: "Open saved results" }))
    fireEvent.click(screen.getByRole("button", { name: /^Open saved Block Party/ }))
    expect(screen.getByRole("region", { name: "Saved Free play result" })).toBeInTheDocument()
    expect(loadFreePlaySnapshot(localStorage, input.clientRunId)?.input).toEqual(input)
    expect(globalThis.fetch).not.toHaveBeenCalled()
}

beforeEach(() => {
    fixture.session = identity(); fixture.mounts = 0; fixture.unmounts = 0
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("Unexpected network request"))))
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    saveFreePlaySnapshot(localStorage, createFreePlaySnapshot(input))
})
afterEach(() => { vi.unstubAllGlobals() })

describe("Shell completed-result recovery across owner transitions", () => {
    it.each(["absent", "present", "empty"] as const)("remounts on Connect with %s member desk and keeps the canonical result", destination => {
        seedDesk("guest:gnoland-1", "game")
        if (destination !== "absent") seedDesk("member:gnoland-1:g1alpha", destination === "empty" ? null : "space-invaders")
        const view = mountShell()
        const old = screen.getByTestId("game:game").getAttribute("data-instance")
        view.changeOwner("g1alpha")
        expect(fixture.unmounts).toBeGreaterThan(0)
        if (destination === "absent") expect(screen.getByTestId("game:game").getAttribute("data-instance")).not.toBe(old)
        else expect(screen.queryByTestId("game:game")).toBeNull()
        if (destination === "present") expect(screen.getByTestId("game:space-invaders")).toBeInTheDocument()
        reopenCanonicalResult()
    })

    it("retains the direct-link window but remounts its consumer on Connect", () => {
        const view = mountShell("/os/arcade/game")
        const old = screen.getByTestId("game:game").getAttribute("data-instance")
        view.changeOwner("g1alpha")
        expect(screen.getByTestId("game:game").getAttribute("data-instance")).not.toBe(old)
        expect(fixture.unmounts).toBeGreaterThan(0)
        reopenCanonicalResult()
    })

    it.each(["/os", "/os/arcade/game"])("isolates account A → B windows on %s while preserving the saved input", path => {
        fixture.session = identity("g1alpha")
        seedDesk("member:gnoland-1:g1alpha", "game")
        seedDesk("member:gnoland-1:g1beta", "space-invaders")
        const view = mountShell(path)
        expect(screen.getByTestId("game:game")).toBeInTheDocument()
        view.changeOwner("g1beta")
        expect(fixture.unmounts).toBeGreaterThan(0)
        expect(screen.queryByTestId("game:game")).toBeNull()
        if (path === "/os") expect(screen.getByTestId("game:space-invaders")).toBeInTheDocument()
        else expect(screen.queryByTestId("game:space-invaders")).toBeNull()
        reopenCanonicalResult()
    })

    it("keeps the same game consumer mounted while opening Your runs at constant owner", () => {
        seedDesk("guest:gnoland-1", "game")
        mountShell()
        const old = screen.getByTestId("game:game").getAttribute("data-instance")
        reopenCanonicalResult()
        expect(screen.getByTestId("game:game").getAttribute("data-instance")).toBe(old)
        expect(fixture.unmounts).toBe(0)
    })
})
