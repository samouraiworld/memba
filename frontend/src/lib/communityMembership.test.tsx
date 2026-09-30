import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { GNO_CHAIN_ID, MEMBA_DAO, isFeedWritable } from "./config"
import { COMMUNITY_MEMBERSHIP_COPY, fetchCommunityMembership, useCommunityMembership } from "./communityMembership"
import { APPLICATION_TARGETS, packageAddress } from "./dao/weightedApplications"
import { directRpcCall } from "./rpcFallback"

vi.mock("./rpcFallback", async original => ({ ...await original<typeof import("./rpcFallback")>(), directRpcCall: vi.fn() }))
vi.mock("./config", async original => ({ ...await original<typeof import("./config")>(), isFeedWritable: vi.fn() }))

const DAO = packageAddress(MEMBA_DAO.realmPath)
const PUBLISHER = "g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf"
const typed = (address: string) => (address ? `("${address}" .uverse.address)` : "( .uverse.address)")

/** A node on `network` whose channels realm answers the two ownership getters with raw qeval text. */
function chain(owner: string, pending: string, network: string = GNO_CHAIN_ID) {
    vi.mocked(directRpcCall).mockImplementation(async (_url, method, params) => {
        if (method === "status") return { node_info: { network } }
        const expression = new TextDecoder().decode(Uint8Array.from(params!.data.slice(2).match(/../g)!, h => parseInt(h, 16)))
        const raw = { [`${APPLICATION_TARGETS.channels}.GetOwner()`]: owner, [`${APPLICATION_TARGETS.channels}.GetPendingOwner()`]: pending }[expression]
        if (raw === undefined) throw new Error(`unexpected read: ${expression}`)
        return { response: { ResponseBase: { Data: btoa(raw), Error: null } } }
    })
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isFeedWritable).mockReturnValue(true)
})

describe("fetchCommunityMembership", () => {
    it("is closed while someone else owns the channels realm (gnoland-1 today: the publisher, DAO nominated)", async () => {
        chain(typed(PUBLISHER), typed(DAO))
        await expect(fetchCommunityMembership()).resolves.toBe("closed")
    })

    it("is open only when the DAO owns the realm and no return is staged", async () => {
        chain(typed(DAO), typed(""))
        await expect(fetchCommunityMembership()).resolves.toBe("open")
    })

    it("claims nothing while a return is staged: the host refuses add-member whenever a pending owner is set", async () => {
        chain(typed(DAO), typed(PUBLISHER))
        await expect(fetchCommunityMembership()).resolves.toBe("unknown")
    })

    it("claims nothing when the realm has no owner", async () => {
        chain(typed(""), typed(""))
        await expect(fetchCommunityMembership()).resolves.toBe("unknown")
    })

    it("refuses an RPC that serves another chain, and an owner it cannot read", async () => {
        chain(typed(DAO), typed(""), "some-other-chain")
        await expect(fetchCommunityMembership()).rejects.toThrow("RPC network does not match the selected chain")
        chain(`("${DAO}" string)`, typed(""))
        await expect(fetchCommunityMembership()).rejects.toThrow("Unexpected authority read")
    })
})

describe("useCommunityMembership", () => {
    /** The hook under its own query client; `settled` resolves once the read has answered or failed. */
    function mount(enabled?: boolean) {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
        const { result } = renderHook(() => useCommunityMembership(enabled), { wrapper })
        const settled = () => waitFor(() => expect(client.getQueryState(["community-membership", GNO_CHAIN_ID])?.status).not.toBe("pending"))
        return { result, settled }
    }

    it("is unknown until the read answers, then open when the DAO owns the channels", async () => {
        chain(typed(DAO), typed(""))
        const { result, settled } = mount()
        expect(result.current).toBe("unknown")
        await settled()
        expect(result.current).toBe("open")
    })

    it("is closed when someone else owns the channels", async () => {
        chain(typed(PUBLISHER), typed(DAO))
        const { result, settled } = mount()
        await settled()
        expect(result.current).toBe("closed")
    })

    it("stays unknown when a return is staged, and when the read fails", async () => {
        chain(typed(DAO), typed(PUBLISHER))
        const staged = mount()
        await staged.settled()
        expect(staged.result.current).toBe("unknown")

        vi.mocked(directRpcCall).mockRejectedValue(new Error("offline"))
        const failed = mount()
        await failed.settled()
        expect(failed.result.current).toBe("unknown")
    })

    it("reads nothing when disabled, or off the network the Feed is indexed on", () => {
        chain(typed(DAO), typed(""))
        expect(mount(false).result.current).toBe("unknown")
        vi.mocked(isFeedWritable).mockReturnValue(false)
        expect(mount().result.current).toBe("unknown")
        expect(directRpcCall).not.toHaveBeenCalled()
    })
})

describe("the copy", () => {
    it("claims admission only in the open state, says what was read when closed, and never a grant", () => {
        expect(COMMUNITY_MEMBERSHIP_COPY.open).toMatch(/owns its community channels and admits members by vote/)
        expect(COMMUNITY_MEMBERSHIP_COPY.closed).toMatch(/does not own its community channels yet, so it cannot admit members/)
        expect(COMMUNITY_MEMBERSHIP_COPY.unknown).not.toMatch(/admit|own/)
        for (const copy of Object.values(COMMUNITY_MEMBERSHIP_COPY)) expect(copy).toMatch(/does not grant membership or a voting seat/)
    })
})
