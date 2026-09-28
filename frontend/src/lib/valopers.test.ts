import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { GNO_CHAIN_ID } from "./config"
import { parseValoperList, parseValoperDetail, computeValoperStatus, fetchValoperListPaged, fetchValopers, findValoperForProfile } from "./valopers"

const snapshot = { url: "https://rpc.example", chainId: GNO_CHAIN_ID, height: 123 }
const mockFetch = vi.fn()
function renderResponse(raw: string) {
    return { ok: true, json: async () => ({ result: { response: { ResponseBase: { Error: null, Data: raw ? btoa(raw) : "" } } } }) }
}
function renderPath(init: RequestInit): string {
    const body = JSON.parse(String(init.body))
    expect(body.params.height).toBe("123")
    return atob(body.params.data).split(":").slice(1).join(":")
}

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
    beforeEach(() => { mockFetch.mockReset(); vi.stubGlobal("fetch", mockFetch) })
    afterEach(() => vi.unstubAllGlobals())

    const line = (m: string, a: string) => ` * [${m}](/r/gnops/valopers:${a}) - [profile](/r/demo/profile:u/${a})`

    it("walks every page until there is no link to the next page", async () => {
        const page1 = [line("v1", "g1aaa"), line("v2", "g1bbb")].join("\n") + "\n\n**1** | [2](?page=2)"
        const page2 = [line("v3", "g1ccc")].join("\n") + "\n\n[1](?page=1) | **2**"
        mockFetch.mockImplementation(async (_url: string, init: RequestInit) => renderResponse(renderPath(init) === "" ? page1 : page2))

        const all = await fetchValoperListPaged("rpc", snapshot)
        expect(all.map(v => v.operatorAddress)).toEqual(["g1aaa", "g1bbb", "g1ccc"])
        expect(mockFetch).toHaveBeenCalledTimes(2) // page 1 + page 2, then stops (no ?page=3)
    })

    it("stops on a single un-paged page", async () => {
        mockFetch.mockResolvedValueOnce(renderResponse(line("solo", "g1solo"))) // no pager marker
        const all = await fetchValoperListPaged("rpc", snapshot)
        expect(all).toHaveLength(1)
        expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it("fails closed if the realm clamps an advertised page back to page 1", async () => {
        // Both pages claim a next page but return the SAME entries.
        const looping = line("v1", "g1aaa") + "\n\n**1** | [2](?page=2)"
        mockFetch.mockResolvedValue(renderResponse(looping))
        await expect(fetchValoperListPaged("rpc", snapshot)).rejects.toThrow(/page 2 repeats/)
        expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it("fails closed if an advertised page is empty", async () => {
        mockFetch.mockResolvedValueOnce(renderResponse(line("v1", "g1aaa") + "\n[2](?page=2)"))
            .mockResolvedValueOnce(renderResponse(""))
        await expect(fetchValoperListPaged("rpc", snapshot)).rejects.toThrow(/page 2 is empty/)
    })

    it("returns empty when the first page is empty", async () => {
        mockFetch.mockResolvedValueOnce(renderResponse(""))
        expect(await fetchValoperListPaged("rpc", snapshot)).toEqual([])
    })

    it("pins every ABCI page to the verified endpoint", async () => {
        mockFetch.mockResolvedValue(renderResponse(line("solo", "g1solo")))
        await fetchValoperListPaged("https://unverified.example", snapshot)
        expect(mockFetch.mock.calls[0][0]).toBe(snapshot.url)
    })

    it("bounds detail fanout and reports partial failures instead of an incomplete registry", async () => {
        const addresses = Array.from({ length: 20 }, (_, i) => `g1operator${i}`)
        const roster = addresses.map((addr, i) => line(`validator-${i}`, addr)).join("\n")
        let active = 0
        let peak = 0
        mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
            const path = renderPath(init)
            if (!path) return renderResponse(roster)
            active++
            peak = Math.max(peak, active)
            await new Promise(resolve => setTimeout(resolve, 1))
            active--
            return renderResponse(`## ${path}\n- Operator Address: ${path}\n- Signing Address: g1signing`)
        })
        const all = await fetchValopers("rpc", new Set(["g1signing"]), snapshot)
        expect(all).toHaveLength(20)
        expect(peak).toBeLessThanOrEqual(8)
        expect(peak).toBeGreaterThan(1)

        mockFetch.mockReset()
        mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
            const path = renderPath(init)
            if (!path) return renderResponse(line("bad", "g1bad"))
            return { ok: false, status: 503 }
        })
        await expect(fetchValopers("rpc", new Set(), snapshot)).rejects.toThrow(/HTTP 503/)
    })

    it("rejects a registry that advertises page 51 past the safety cap", async () => {
        mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
            const path = renderPath(init)
            const page = path ? Number(path.split("=")[1]) : 1
            return renderResponse(line(`v${page}`, `g1operator${page}`) + `\n[${page + 1}](?page=${page + 1})`)
        })
        await expect(fetchValoperListPaged("rpc", snapshot)).rejects.toThrow(/50-page safety limit/)
        expect(mockFetch).toHaveBeenCalledTimes(50)
    })

    it("aborts in-flight detail reads without scheduling the rest of the roster", async () => {
        const addresses = Array.from({ length: 20 }, (_, i) => `g1operator${i}`)
        const roster = addresses.map((addr, i) => line(`validator-${i}`, addr)).join("\n")
        const controller = new AbortController()
        let detailStarts = 0
        mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
            if (!renderPath(init)) return renderResponse(roster)
            detailStarts++
            return new Promise((_resolve, reject) => {
                init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
            })
        })
        const pending = fetchValopers("rpc", new Set(), snapshot, controller.signal)
        await vi.waitFor(() => expect(detailStarts).toBe(8))
        controller.abort()
        await expect(pending).rejects.toMatchObject({ name: "AbortError" })
        expect(detailStarts).toBe(8)
    })
})

describe("findValoperForProfile", () => {
    beforeEach(() => { mockFetch.mockReset(); vi.stubGlobal("fetch", mockFetch) })
    afterEach(() => vi.unstubAllGlobals())

    const roster = ` * [one](/r/gnops/valopers:g1operator1)\n * [two](/r/gnops/valopers:g1operator2)\n * [three](/r/gnops/valopers:g1operator3)`
    const detail = (operator: string, signer: string) => `## ${operator}\n- Operator Address: ${operator}\n- Signing Address: ${signer}`

    it("reads only the requested operator detail and computes live status", async () => {
        mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
            const path = renderPath(init)
            return renderResponse(path ? detail(path, "g1signer2") : roster)
        })
        const result = await findValoperForProfile("untrusted", "g1operator2", new Set(["g1signer2"]), snapshot)
        expect(result).toMatchObject({ operatorAddress: "g1operator2", signingAddress: "g1signer2", status: "active" })
        expect(mockFetch.mock.calls.map(([, init]) => renderPath(init))).toEqual(["", "g1operator2"])
        expect(mockFetch.mock.calls.every(([url]) => url === snapshot.url)).toBe(true)
    })

    it("returns a verified signing match despite an unrelated detail failure", async () => {
        mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
            const path = renderPath(init)
            if (!path) return renderResponse(roster)
            if (path === "g1operator1") return { ok: false, status: 503 }
            return renderResponse(detail(path, path === "g1operator3" ? "g1target" : "g1other"))
        })
        const result = await findValoperForProfile("rpc", "g1target", new Set(), snapshot)
        expect(result).toMatchObject({ operatorAddress: "g1operator3", status: "candidate" })
    })

    it("fails closed when an incomplete scan cannot rule out a signing match", async () => {
        mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
            const path = renderPath(init)
            if (!path) return renderResponse(roster)
            return path === "g1operator2" ? renderResponse("malformed detail") : renderResponse(detail(path, "g1other"))
        })
        await expect(findValoperForProfile("rpc", "g1unknown", new Set(), snapshot)).rejects.toThrow(/scan incomplete/)
    })

    it("returns no match only after every registry detail has been checked", async () => {
        mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
            const path = renderPath(init)
            return renderResponse(path ? detail(path, "g1other") : roster)
        })
        expect(await findValoperForProfile("rpc", "g1unknown", new Set(), snapshot)).toBeNull()
        expect(mockFetch).toHaveBeenCalledTimes(4)
    })

    it("propagates cancellation during a signing-address scan", async () => {
        const controller = new AbortController()
        mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
            const path = renderPath(init)
            if (!path) return renderResponse(roster)
            return new Promise((_resolve, reject) => {
                init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
            })
        })
        const pending = findValoperForProfile("rpc", "g1target", new Set(), snapshot, controller.signal)
        await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(4))
        controller.abort()
        await expect(pending).rejects.toMatchObject({ name: "AbortError" })
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
