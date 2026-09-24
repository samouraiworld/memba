import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

const registrar = vi.hoisted(() => ({ path: "gno.land/r/sys/namereg/v0" as string | null }))

vi.mock("../../lib/config", async (orig) => ({
    ...(await orig<typeof import("../../lib/config")>()),
    getUsernameRegistrarPath: () => registrar.path,
    GNO_FAUCET_URL: "",
}))
vi.mock("../../lib/grc20", async (orig) => ({
    ...(await orig<typeof import("../../lib/grc20")>()),
    doContractBroadcast: vi.fn(async () => undefined),
}))
vi.mock("../../lib/rpcFallback", async (orig) => ({
    ...(await orig<typeof import("../../lib/rpcFallback")>()),
    resilientAbciQuery: vi.fn(async () => "(0 int64)"),
}))
vi.mock("../../lib/dao/shared", async (orig) => ({
    ...(await orig<typeof import("../../lib/dao/shared")>()),
    forgetRegisteredUsername: vi.fn(),
}))

import { doContractBroadcast } from "../../lib/grc20"
import { resilientAbciQuery } from "../../lib/rpcFallback"
import { forgetRegisteredUsername } from "../../lib/dao/shared"
import { RegisterUsernameForm } from "./RegisterUsernameForm"

const CALLER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"

describe("RegisterUsernameForm", () => {
    beforeEach(() => {
        registrar.path = "gno.land/r/sys/namereg/v0"
        vi.mocked(doContractBroadcast).mockClear()
        vi.mocked(forgetRegisteredUsername).mockClear()
        vi.mocked(resilientAbciQuery).mockResolvedValue("(0 int64)")
    })

    const register = (name = "nym-builder042") => {
        render(<RegisterUsernameForm address={CALLER} onRegistered={() => {}} />)
        fireEvent.change(screen.getByLabelText("Username to register"), { target: { value: name } })
        fireEvent.click(screen.getByRole("button", { name: "Register" }))
    }

    it("sends exactly a non-zero on-chain price", async () => {
        vi.mocked(resilientAbciQuery).mockResolvedValue("(1500000 int64)")
        register()
        await waitFor(() => expect(doContractBroadcast).toHaveBeenCalledTimes(1))
        const [[msg]] = vi.mocked(doContractBroadcast).mock.calls[0] as unknown as [[{ value: { send: string } }]]
        expect(msg.value.send).toBe("1500000ugnot")
    })

    it("sends nothing when the price cannot be read", async () => {
        vi.mocked(resilientAbciQuery).mockRejectedValue(new Error("RPC down"))
        register()
        expect(await screen.findByText(/Couldn't read the registration price/)).toBeTruthy()
        expect(doContractBroadcast).not.toHaveBeenCalled()
    })

    it("drops the cached 'no username' after a successful registration", async () => {
        register()
        await waitFor(() => expect(forgetRegisteredUsername).toHaveBeenCalledWith(CALLER))
    })

    it("registers through the network's registrar with the exact on-chain price", async () => {
        render(<RegisterUsernameForm address={CALLER} onRegistered={() => {}} />)
        fireEvent.change(screen.getByLabelText("Username to register"), { target: { value: "nym-builder042" } })
        fireEvent.click(screen.getByRole("button", { name: "Register" }))
        await waitFor(() => expect(doContractBroadcast).toHaveBeenCalledTimes(1))
        expect(vi.mocked(doContractBroadcast).mock.calls[0][0]).toEqual([{
            type: "vm/MsgCall",
            value: { caller: CALLER, send: "", pkg_path: "gno.land/r/sys/namereg/v0", func: "Register", args: ["nym-builder042"] },
        }])
    })

    it("keeps Register disabled for a name the registrar would refuse", () => {
        render(<RegisterUsernameForm address={CALLER} onRegistered={() => {}} />)
        fireEvent.change(screen.getByLabelText("Username to register"), { target: { value: "zooma_dev" } })
        expect((screen.getByRole("button", { name: "Register" }) as HTMLButtonElement).disabled).toBe(true)
    })

    it("offers no faucet link on a network without a faucet", () => {
        render(<RegisterUsernameForm address={CALLER} onRegistered={() => {}} />)
        expect(screen.queryByText(/faucet/i)).toBeNull()
    })

    it("renders nothing where no registrar is verified", () => {
        registrar.path = null
        const { container } = render(<RegisterUsernameForm address={CALLER} onRegistered={() => {}} />)
        expect(container.innerHTML).toBe("")
    })
})
