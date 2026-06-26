import { describe, it, expect, vi, beforeEach } from "vitest"
import { parseValoperList, parseValoperDetail, computeValoperStatus, fetchValoperListPaged } from "./valopers"

// Mock the realm render layer so we can drive multi-page roster responses.
vi.mock("./dao/shared", () => ({ queryRender: vi.fn() }))
import { queryRender } from "./dao/shared"
const mockRender = vi.mocked(queryRender)

// Fixtures mirror the exact output of gno.land/r/gnops/valopers:
//   renderHome  → " * [Moniker](/r/gnops/valopers:g1op) - [profile](/r/demo/profile:u/g1op)"
//   Render(addr) → "Valoper's details:\n## Moniker\n<desc>\n\n- Operator Address: ...\n- Signing Address: ...\n- Signing PubKey: ...\n- Server Type: ...\n\n[Profile link](...)"

describe("parseValoperList", () => {
    it("extracts moniker + operator address for each registered valoper, ignoring instructions and the pager", () => {
        const raw = `# Valopers

Register your validator by calling Register(...).

 * [gnocore-val-01](/r/gnops/valopers:g1operator001) - [profile](/r/demo/profile:u/g1operator001)
 * [berty-val2](/r/gnops/valopers:g1operator002) - [profile](/r/demo/profile:u/g1operator002)

| [1](?page=1) |`

        const list = parseValoperList(raw)
        expect(list).toHaveLength(2)
        expect(list[0]).toEqual({ moniker: "gnocore-val-01", operatorAddress: "g1operator001" })
        expect(list[1]).toEqual({ moniker: "berty-val2", operatorAddress: "g1operator002" })
    })

    it("returns an empty array when there are no valopers", () => {
        expect(parseValoperList("No valopers to display.")).toEqual([])
    })
})

describe("fetchValoperListPaged", () => {
    beforeEach(() => mockRender.mockReset())

    const line = (m: string, a: string) => ` * [${m}](/r/gnops/valopers:${a}) - [profile](/r/demo/profile:u/${a})`

    it("walks every page until there is no link to the next page", async () => {
        const page1 = [line("v1", "g1aaa"), line("v2", "g1bbb")].join("\n") + "\n\n**1** | [2](?page=2)"
        const page2 = [line("v3", "g1ccc")].join("\n") + "\n\n[1](?page=1) | **2**"
        mockRender.mockImplementation(async (_rpc, _pkg, path) => (path === "" ? page1 : page2))

        const all = await fetchValoperListPaged("rpc")
        expect(all.map(v => v.operatorAddress)).toEqual(["g1aaa", "g1bbb", "g1ccc"])
        expect(mockRender).toHaveBeenCalledTimes(2) // page 1 + page 2, then stops (no ?page=3)
    })

    it("stops on a single un-paged page", async () => {
        mockRender.mockResolvedValueOnce(line("solo", "g1solo")) // no pager marker
        const all = await fetchValoperListPaged("rpc")
        expect(all).toHaveLength(1)
        expect(mockRender).toHaveBeenCalledTimes(1)
    })

    it("stops (no infinite loop) if the realm clamps an out-of-range page back to page 1", async () => {
        // Both pages claim a next page but return the SAME entries → dedup yields nothing new.
        const looping = line("v1", "g1aaa") + "\n\n**1** | [2](?page=2)"
        mockRender.mockResolvedValue(looping)
        const all = await fetchValoperListPaged("rpc")
        expect(all.map(v => v.operatorAddress)).toEqual(["g1aaa"])
        expect(mockRender).toHaveBeenCalledTimes(2) // page 1, page 2 adds nothing → break
    })

    it("returns empty when the first page is empty", async () => {
        mockRender.mockResolvedValueOnce("")
        expect(await fetchValoperListPaged("rpc")).toEqual([])
    })
})

describe("parseValoperDetail", () => {
    it("parses all fields from a valoper detail render, including the 'Valoper's details:' prefix", () => {
        const raw = `Valoper's details:
## gnocore-val-01
The core gno.land validator, run by the core team.

- Operator Address: g1operator001
- Signing Address: g1signing001
- Signing PubKey: gpub1pgfj7ord9eqnj06z1pubkey
- Server Type: cloud

[Profile link](/r/demo/profile:u/g1operator001)`

        const v = parseValoperDetail(raw)
        expect(v).not.toBeNull()
        expect(v).toEqual({
            moniker: "gnocore-val-01",
            description: "The core gno.land validator, run by the core team.",
            operatorAddress: "g1operator001",
            signingAddress: "g1signing001",
            signingPubKey: "gpub1pgfj7ord9eqnj06z1pubkey",
            serverType: "cloud",
        })
    })

    it("handles a valoper with no description", () => {
        const raw = `Valoper's details:
## zxq-val-01

- Operator Address: g1operator003
- Signing Address: g1signing003
- Signing PubKey: gpub1xyz
- Server Type: on-prem

[Profile link](/r/demo/profile:u/g1operator003)`

        const v = parseValoperDetail(raw)
        expect(v?.moniker).toBe("zxq-val-01")
        expect(v?.description).toBe("")
        expect(v?.serverType).toBe("on-prem")
        expect(v?.signingAddress).toBe("g1signing003")
    })

    it("returns null for an unknown/invalid address response", () => {
        expect(parseValoperDetail("unknown address g1nope")).toBeNull()
        expect(parseValoperDetail("invalid address foo")).toBeNull()
    })
})

describe("computeValoperStatus", () => {
    it("is 'active' when the valoper's signing address is in the live validator set", () => {
        const active = new Set(["g1signing001", "g1signing002"])
        expect(computeValoperStatus("g1signing001", active)).toBe("active")
    })

    it("is 'candidate' when the valoper is registered but not in the active set", () => {
        const active = new Set(["g1signing001"])
        expect(computeValoperStatus("g1signing999", active)).toBe("candidate")
    })

    it("is 'candidate' when there is no signing address yet", () => {
        expect(computeValoperStatus("", new Set(["g1signing001"]))).toBe("candidate")
    })
})
