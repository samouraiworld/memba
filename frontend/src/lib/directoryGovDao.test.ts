import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./dao/shared", async importOriginal => ({
    ...await importOriginal<typeof import("./dao/shared")>(),
    queryRender: vi.fn(),
    queryRenderPage: vi.fn(),
}))

import { queryRender, queryRenderPage } from "./dao/shared"
import { fetchVerifiedDirectoryGovDAOProposals } from "./directoryGovDao"

const RPC = "https://rpc.gno.land"
const PATH = "gno.land/r/gov/dao"

describe("Directory GovDAO verified read", () => {
    beforeEach(() => vi.clearAllMocks())

    it("reads every paginated Render through the strict verified path", async () => {
        vi.mocked(queryRender).mockResolvedValue("### [Prop #1 - First](/r/gov/dao:1)\nStatus: ACTIVE\n\n[2](?page=2)")
        vi.mocked(queryRenderPage).mockResolvedValue("### [Prop #2 - Second](/r/gov/dao:2)\nStatus: ACCEPTED")
        const rows = await fetchVerifiedDirectoryGovDAOProposals(RPC, PATH)
        expect(rows.map(row => row.id)).toEqual([2, 1])
        expect(queryRender).toHaveBeenCalledWith(RPC, PATH, "", true)
        expect(queryRenderPage).toHaveBeenCalledWith(RPC, PATH, "?page=2", true)
    })

    it("fails instead of showing a partial list when a verified page is missing", async () => {
        vi.mocked(queryRender).mockResolvedValue("### [Prop #1 - First](/r/gov/dao:1)\n\n[2](?page=2)")
        vi.mocked(queryRenderPage).mockResolvedValue(null)
        await expect(fetchVerifiedDirectoryGovDAOProposals(RPC, PATH)).rejects.toThrow("could not be read")
    })

    it("rejects a truthy not-found page advertised by the pager", async () => {
        vi.mocked(queryRender).mockResolvedValue("## Proposals\n### [Prop #1 - First](/r/gov/dao:1)\n\n[2](?page=2)")
        vi.mocked(queryRenderPage).mockResolvedValue("# Not Found")
        await expect(fetchVerifiedDirectoryGovDAOProposals(RPC, PATH)).rejects.toThrow("could not be verified")
    })
})
