import { expect, it, vi } from "vitest"
vi.mock("./rpcFallback", async importOriginal => ({ ...(await importOriginal<typeof import("./rpcFallback")>()), resilientFetch: vi.fn() }))
import { resilientFetch } from "./rpcFallback"
import { fetchAccountInfo } from "./account"

const ADDRESS = "g14sngp6hjx9jchqk4pmkqrkesdklhwpd43q5vur"
function respond(value: unknown) { vi.mocked(resilientFetch).mockResolvedValue(new Response(JSON.stringify(value))) }

it("reads a nonzero account number and sequence from the native ABCI response", async () => {
    const address = "g14sngp6hjx9jchqk4pmkqrkesdklhwpd43q5vur"
    vi.mocked(resilientFetch).mockResolvedValue(new Response(JSON.stringify({ result: { response: { ResponseBase: { Error: null, Data: btoa(JSON.stringify({ BaseAccount: { address, account_number: "7", sequence: "3" } })) } } } })))
    expect(await fetchAccountInfo(address)).toEqual({ accountNumber: 7, sequence: 3 })
})

it("accepts native JSON null as a genuinely missing account", async () => {
    respond({ result: { response: { ResponseBase: { Error: null, Data: btoa("null") } } } })
    expect(await fetchAccountInfo(ADDRESS)).toEqual({ accountNumber: 0, sequence: 0 })
})

it.each([
    {}, { error: { message: "unavailable" } },
    { result: { response: { ResponseBase: { Error: { "@type": "/std.InternalError" }, Data: null } } } },
    { result: { response: { ResponseBase: { Error: null, Data: null } } } },
])("never turns malformed or failed native replies into zero counters", async reply => {
    respond(reply)
    await expect(fetchAccountInfo(ADDRESS)).rejects.toThrow()
})

it.each(["4294967296", "9007199254740993", "-1", "7junk", undefined])("rejects unsupported account counters (%s)", async counter => {
    respond({ result: { response: { ResponseBase: { Data: btoa(JSON.stringify({ BaseAccount: { account_number: counter, sequence: "1" } })) } } } })
    await expect(fetchAccountInfo(ADDRESS)).rejects.toThrow()
})
