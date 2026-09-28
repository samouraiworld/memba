import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useBalance } from "./useBalance"
import { resilientFetch } from "../lib/rpcFallback"

vi.mock("../lib/rpcFallback", () => ({ resilientFetch: vi.fn() }))

const A = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const B = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const response = (coins?: string) => ({ json: async () => ({ result: { response: { ResponseBase: coins === undefined ? {} : { Data: btoa(JSON.stringify(coins)) } } } }) }) as Response

afterEach(() => { vi.clearAllMocks() })

describe("useBalance", () => {
    it("distinguishes an explicit empty balance from a missing or failed RPC response", async () => {
        vi.mocked(resilientFetch).mockResolvedValueOnce(response(""))
        const hook = renderHook(() => useBalance(A, 0))
        await waitFor(() => expect(hook.result.current.rawUgnot).toBe(0n))
        vi.mocked(resilientFetch).mockResolvedValueOnce(response())
        await act(async () => { await hook.result.current.refetch() })
        expect(hook.result.current.rawUgnot).toBeUndefined()
        expect(hook.result.current.balance).toBe("? GNOT")
        hook.unmount()
    })

    it("removes a formerly known balance after an RPC failure", async () => {
        vi.mocked(resilientFetch).mockResolvedValueOnce(response("9000000ugnot"))
        const hook = renderHook(() => useBalance(A, 0))
        await waitFor(() => expect(hook.result.current.rawUgnot).toBe(9_000_000n))
        vi.mocked(resilientFetch).mockRejectedValueOnce(new Error("offline"))
        const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
        await act(async () => { await hook.result.current.refetch() })
        expect(hook.result.current.rawUgnot).toBeUndefined()
        expect(hook.result.current.error).toBe("offline")
        warning.mockRestore()
        hook.unmount()
    })

    it("never exposes account A's delayed response as account B's balance", async () => {
        let finishA!: (value: Response) => void
        vi.mocked(resilientFetch).mockImplementation((build) => {
            const path = JSON.parse(String(build("https://rpc.gno.land").init.body)).params.path as string
            return path.endsWith(A) ? new Promise<Response>((resolve) => { finishA = resolve }) : Promise.resolve(response("2000000ugnot"))
        })
        const hook = renderHook(({ address }) => useBalance(address, 0), { initialProps: { address: A } })
        await waitFor(() => expect(typeof finishA).toBe("function"))
        hook.rerender({ address: B })
        expect(hook.result.current.rawUgnot).toBeUndefined()
        await waitFor(() => expect(hook.result.current.rawUgnot).toBe(2_000_000n))
        await act(async () => { finishA(response("9000000ugnot")) })
        expect(hook.result.current.rawUgnot).toBe(2_000_000n)
        hook.unmount()
    })
})
