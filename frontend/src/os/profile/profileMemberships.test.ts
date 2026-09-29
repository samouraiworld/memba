import { beforeEach, describe, expect, it, vi } from "vitest"
import { readProfileMemberships } from "./profileMemberships"
import { getDAOMembers } from "../../lib/dao/members"

vi.mock("../../lib/config", () => ({ ACTIVE_NETWORK_KEY: "mainnet", GNO_RPC_URL: "https://rpc.example" }))
vi.mock("../../lib/dao/chainIdentity", () => ({ assertActiveRpcChain: vi.fn(async () => {}) }))
vi.mock("../../lib/directory", () => ({ getDirectoryDAOs: () => [
    { name: "GovDAO", path: "gno.land/r/gov/dao" },
    { name: "Builders", path: "gno.land/r/builders/dao" },
] }))
vi.mock("../../lib/dao/members", () => ({ getDAOMembers: vi.fn() }))

const address = "g1manfred47kzduec920z88wfr64ylksmdcedlf5"

describe("profile DAO coverage", () => {
    beforeEach(() => vi.clearAllMocks())

    it("keeps roster roles and reports incomplete coverage", async () => {
        vi.mocked(getDAOMembers).mockResolvedValueOnce([{ address, roles: ["admin"], tier: "founder", votingPower: 3, username: "" }])
            .mockRejectedValueOnce(new Error("offline"))
        expect(await readProfileMemberships(address)).toEqual({
            memberships: [{ name: "GovDAO", path: "gno.land/r/gov/dao", roles: ["admin"], tier: "founder", votingPower: 3 }],
            checkedRealms: [{ name: "GovDAO", path: "gno.land/r/gov/dao" }],
            checked: 1, failed: 1, omitted: 0,
        })
    })
})
