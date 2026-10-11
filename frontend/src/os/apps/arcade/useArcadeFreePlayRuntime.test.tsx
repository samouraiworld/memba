import { StrictMode, type ReactNode } from "react"
import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useArcadeFreePlayRuntime, type ArcadeFreePlayConfiguration } from "./useArcadeFreePlayRuntime"
import type { FreePlayOsSession } from "../../../games/arcade/freeplay/osAuth"
import type { OsSession } from "../../shell/useOsSession"
const mocks = vi.hoisted(() => ({
    owners: [] as { read(): FreePlayOsSession; refresh: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[],
    client: vi.fn(() => ({ board: vi.fn() })),
}))
vi.mock("../../../lib/arcadeFreePlay", async original => ({ ...(await original<typeof import("../../../lib/arcadeFreePlay")>()), createFreePlayClient: mocks.client }))
vi.mock("../../../games/arcade/freeplay/osAuth", () => ({ createOsFreePlayAuth: ({ readSession }: { readSession(): FreePlayOsSession }) => {
    const owner = { read: readSession, refresh: vi.fn(), dispose: vi.fn() }
    mocks.owners.push(owner)
    return { refreshIdentity: owner.refresh, dispose: owner.dispose }
} }))
const session = { status: "guest", layout: { auth: { token: null } }, address: "", walletAddress: "", walletChainId: "", network: { chainId: "test-chain" }, openConnect: vi.fn() } as unknown as OsSession
const settings = (): ArcadeFreePlayConfiguration => ({ chainId: "test-chain", storage: { getItem: () => null, setItem: vi.fn() }, games: { "block-party": { rules: "bp-free-standard-undo-v1", simVersion: 1 }, "space-invaders": { rules: "si-free-standard-v1", simVersion: 1 } } })
const options = (configuration: ArcadeFreePlayConfiguration | null) => ({ session, locked: false, onEvm: false, configuration })
beforeEach(() => { mocks.owners.length = 0; mocks.client.mockClear(); vi.mocked(session.openConnect).mockClear() })

describe("workspace free play runtime owner", () => {
    it("stays dormant without explicit configuration", () => {
        const { result } = renderHook(() => useArcadeFreePlayRuntime(options(null)))
        expect(result.current).toBeNull()
        expect(mocks.owners).toHaveLength(0)
    })
    it("shares stable storage and clients across games; no remote still supports local results", () => {
        const local = settings()
        const remote = { origin: "https://scores.example/", target: { chainId: "test-chain", realm: "gno.land/r/samcrew/memba_arcade_scores_v2" } }
        const config: ArcadeFreePlayConfiguration = { ...local, games: {
            "block-party": { ...local.games["block-party"]!, remote },
            "space-invaders": { ...local.games["space-invaders"]!, remote },
            barricade: { rules: "barricade-fps-c1", simVersion: 3 },
        } }
        const view = renderHook(props => useArcadeFreePlayRuntime(props), { initialProps: options(config) })
        const first = view.result.current!
        expect(mocks.client).toHaveBeenCalledTimes(1)
        expect(first.games["block-party"]!.client).toBe(first.games["space-invaders"]!.client)
        expect(first.games.barricade!.storage).toBe(first.games["block-party"]!.storage)
        expect(first.games.barricade!.client).toBeUndefined()
        expect(first.recovery).toBeUndefined()
        view.rerender(options(config))
        expect(view.result.current).toBe(first)
        expect(mocks.owners).toHaveLength(1)
    })
    it("disposes on lock and cannot resurrect the old owner on unlock", () => {
        const config = settings()
        const view = renderHook(props => useArcadeFreePlayRuntime(props), { initialProps: options(config) })
        const old = view.result.current
        view.rerender({ ...options(config), locked: true })
        expect(view.result.current).toBeNull()
        expect(mocks.owners[0].dispose).toHaveBeenCalledOnce()
        expect(mocks.owners[0].read().status).toBe("guest")
        view.rerender(options(config))
        expect(view.result.current).not.toBe(old)
        expect(mocks.owners).toHaveLength(2)
        old!.games["block-party"]!.connect!()
        expect(session.openConnect).not.toHaveBeenCalled()
    })
    it("fails closed for EVM or a mismatched configured chain", () => {
        const config = settings()
        const view = renderHook(props => useArcadeFreePlayRuntime(props), { initialProps: { ...options(config), onEvm: true } })
        expect(view.result.current).toBeNull()
        view.rerender(options({ ...config, chainId: "other-chain" }))
        expect(view.result.current).toBeNull()
        expect(mocks.owners).toHaveLength(0)
    })
    it("rejects unsupported rules before constructing auth or clients", () => {
        const config = settings()
        const { result } = renderHook(() => useArcadeFreePlayRuntime(options({ ...config, games: { "block-party": { rules: "unreviewed", simVersion: 1 } } })))
        expect(result.current).toBeNull()
        expect(mocks.owners).toHaveLength(0)
        expect(mocks.client).not.toHaveBeenCalled()
    })
    it("refreshes committed identity and disposes the previous owner on an account transition", () => {
        const config = settings()
        const view = renderHook(props => useArcadeFreePlayRuntime(props), { initialProps: options(config) })
        view.rerender({ ...options(config), session: { ...session, address: "changed", walletAddress: "changed" } })
        expect(mocks.owners[0].dispose).toHaveBeenCalledOnce()
        expect(mocks.owners[1].read().address).toBe("changed")
        expect(mocks.owners[0].refresh).toHaveBeenCalled()
    })
    it("notifies on successful saves and storage events, and removes observers on dispose", () => {
        const config = settings()
        const view = renderHook(() => useArcadeFreePlayRuntime(options(config)))
        const saved = vi.fn()
        view.result.current!.subscribeSavedRuns!(saved)
        act(() => view.result.current!.games["block-party"]!.storage.setItem("saved-id", "result"))
        expect(saved).toHaveBeenCalledTimes(1)
        act(() => window.dispatchEvent(new StorageEvent("storage")))
        expect(saved).toHaveBeenCalledTimes(2)
        view.unmount()
        window.dispatchEvent(new StorageEvent("storage"))
        expect(saved).toHaveBeenCalledTimes(2)
    })
    it("leaves one live bridge under StrictMode and none after unmount", () => {
        const config = settings()
        const view = renderHook(() => useArcadeFreePlayRuntime(options(config)), { wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode> })
        expect(mocks.owners.filter(owner => owner.dispose.mock.calls.length === 0)).toHaveLength(1)
        view.unmount()
        expect(mocks.owners.every(owner => owner.dispose.mock.calls.length === 1)).toBe(true)
    })
})
