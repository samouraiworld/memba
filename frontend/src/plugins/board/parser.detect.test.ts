import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("../../lib/dao/shared", async (orig) => ({ ...(await orig<object>()), queryRender: vi.fn() }))
import { queryRender } from "../../lib/dao/shared"
import { boardExists, detectChannelRealm } from "./parser"
import { MEMBA_DAO } from "../../lib/config"

describe("detectChannelRealm", () => {
    beforeEach(() => vi.mocked(queryRender).mockImplementation(async (_rpc, path) =>
        path === MEMBA_DAO.channelsPath || path === "gno.land/r/alice/dao_channels" ? "# Channels" : null))

    it("never resolves another DAO to MembaDAO's channels", async () => {
        expect(await detectChannelRealm("rpc", "gno.land/r/bob/dao")).toBeNull()
        expect(await detectChannelRealm("rpc", "gno.land/r/alice/dao")).toBe("gno.land/r/alice/dao_channels")
    })

    it("uses the configured channels realm only for MembaDAO itself", async () => {
        expect(await detectChannelRealm("rpc", MEMBA_DAO.realmPath)).toBe(MEMBA_DAO.channelsPath)
    })

    it("does not fall back to derived paths for MembaDAO when its configured realm is absent", async () => {
        vi.mocked(queryRender).mockImplementation(async (_rpc, path) => path === `${MEMBA_DAO.realmPath}_channels` ? "# Channels" : null)
        expect(await detectChannelRealm("rpc", MEMBA_DAO.realmPath)).toBeNull()
    })

    it("falls back to the _board suffix for the DAO's own board", async () => {
        vi.mocked(queryRender).mockImplementation(async (_rpc, path) => path === "gno.land/r/carol/dao_board" ? "# Board" : null)
        expect(await detectChannelRealm("rpc", "gno.land/r/carol/dao")).toBe("gno.land/r/carol/dao_board")
    })
})

describe("boardExists", () => {
    it("treats content that mentions 404 as an existing board", async () => {
        vi.mocked(queryRender).mockResolvedValue("# Channels\n\n- #general: error 404 postmortem (3 threads)")
        expect(await boardExists("rpc", "gno.land/r/alice/dao_channels")).toBe(true)
    })

    it("treats a failed or empty render as absent", async () => {
        vi.mocked(queryRender).mockResolvedValue(null)
        expect(await boardExists("rpc", "gno.land/r/alice/dao_channels")).toBe(false)
    })
})
