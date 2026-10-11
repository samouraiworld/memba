import { afterEach, describe, expect, it, vi } from "vitest"
import * as client from "../lib/arcadeFreePlay"
import * as auth from "../games/arcade/freeplay/osAuth"
import { ARCADE_FREE_PLAY_DEPLOYMENT, resolveArcadeFreePlayDeployment, type ArcadeFreePlayDeployment } from "./arcadeFreePlayDeployment"
import type { SnapshotStorage } from "../games/arcade/freeplay/snapshot"

const local: ArcadeFreePlayDeployment = {
    chainId: "test-chain",
    games: { "block-party": { rules: "bp-free-standard-undo-v1", simVersion: 1 } },
}
const remote = { origin: "https://backend.example", target: { chainId: local.chainId, realm: "gno.land/r/samcrew/memba_arcade_scores_v2" } }
const reviewed: ArcadeFreePlayDeployment = { ...local, games: {
    "block-party": { ...local.games["block-party"]!, remote },
} }
const memory = () => ({ getItem: vi.fn(() => null), setItem: vi.fn() })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("reviewed Arcade deployment adapter", () => {
    it("ships disabled and does not acquire storage, auth, client or network", () => {
        const getStorage = vi.fn(() => { throw new Error("Storage denied") })
        const createClient = vi.spyOn(client, "createFreePlayClient")
        const createAuth = vi.spyOn(auth, "createOsFreePlayAuth")
        const fetch = vi.fn()
        vi.stubGlobal("fetch", fetch)
        expect(ARCADE_FREE_PLAY_DEPLOYMENT).toBeNull()
        expect(resolveArcadeFreePlayDeployment(ARCADE_FREE_PLAY_DEPLOYMENT, getStorage)).toBeNull()
        expect(getStorage).not.toHaveBeenCalled()
        expect(createClient).not.toHaveBeenCalled()
        expect(createAuth).not.toHaveBeenCalled()
        expect(fetch).not.toHaveBeenCalled()
    })

    it.each([local, reviewed])("adds only host storage without accessing snapshot data", deployment => {
        const storage = memory(), getStorage = vi.fn(() => storage)
        const createClient = vi.spyOn(client, "createFreePlayClient")
        const createAuth = vi.spyOn(auth, "createOsFreePlayAuth")
        const configuration = resolveArcadeFreePlayDeployment(deployment, getStorage)
        expect(configuration).toEqual({ ...deployment, storage })
        expect(configuration?.storage).toBe(storage)
        expect(getStorage).toHaveBeenCalledTimes(1)
        expect(storage.getItem).not.toHaveBeenCalled()
        expect(storage.setItem).not.toHaveBeenCalled()
        expect(createClient).not.toHaveBeenCalled()
        expect(createAuth).not.toHaveBeenCalled()
        expect(deployment).not.toHaveProperty("storage")
    })

    it("rejects invalid origin, realm, chain, rules, version or game before acquiring storage", () => {
        const game = reviewed.games["block-party"]!
        const invalid = [
            { ...reviewed, chainId: "" },
            { ...reviewed, games: { unknown: game } },
            ...[
                { ...game, rules: "daily" },
                { ...game, simVersion: 2 },
                { ...game, remote: { ...remote, origin: "http://backend.example" } },
                { ...game, remote: { ...remote, origin: "https://backend.example/config?chain=other" } },
                { ...game, remote: { ...remote, target: { ...remote.target, chainId: "other-chain" } } },
                { ...game, remote: { ...remote, target: { ...remote.target, realm: "gno.land/r/other" } } },
            ].map(config => ({ ...reviewed, games: { "block-party": config } })),
        ]
        const getStorage = vi.fn(() => memory())
        for (const deployment of invalid) {
            expect(resolveArcadeFreePlayDeployment(deployment as ArcadeFreePlayDeployment, getStorage)).toBeNull()
        }
        expect(getStorage).not.toHaveBeenCalled()
    })

    it("fails closed when storage acquisition is denied or structurally unavailable", () => {
        const denied = vi.fn(() => { throw new DOMException("Synthetic denial", "SecurityError") })
        expect(resolveArcadeFreePlayDeployment(reviewed, denied)).toBeNull()
        expect(denied).toHaveBeenCalledTimes(1)
        expect(resolveArcadeFreePlayDeployment(reviewed, () => null as unknown as SnapshotStorage)).toBeNull()
        expect(resolveArcadeFreePlayDeployment(reviewed, () => ({ getItem: () => null }) as SnapshotStorage)).toBeNull()
    })

    it("does not probe storage with writes or swallow later persistence failures", () => {
        const storage = { getItem: vi.fn(() => null), setItem: vi.fn(() => { throw new Error("quota") }) }
        const configuration = resolveArcadeFreePlayDeployment(local, () => storage)
        expect(storage.getItem).not.toHaveBeenCalled()
        expect(storage.setItem).not.toHaveBeenCalled()
        expect(() => configuration!.storage.setItem("result", "synthetic")).toThrow("quota")
    })
})
