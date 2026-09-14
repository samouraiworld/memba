import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { secp256k1 } from "@noble/curves/secp256k1.js"
import { createNativeMultisig, memberAddress, nativeAddress } from "../lib/nativeMultisig"

const config = vi.hoisted(() => ({ ENABLE_NATIVE_GNO_MULTISIG: true, GNO_CHAIN_ID: "native-local", GNO_RPC_URL: "http://127.0.0.1:26657", GNO_BECH32_PREFIX: "g" }))
vi.mock("../lib/config", () => config)
vi.mock("react-router-dom", () => ({ useOutletContext: () => ({ auth: { isAuthenticated: true, token: { userAddress: "test-member" } } }) }))
vi.mock("../hooks/useNetworkNav", () => ({ useNetworkNav: () => vi.fn() }))
vi.mock("../lib/api", () => ({ api: { createOrJoinMultisig: vi.fn() } }))
vi.mock("../components/ui/ErrorToast", () => ({ ErrorToast: ({ message }: { message: string | null }) => message ? <p role="alert">{message}</p> : null }))
import { api } from "../lib/api"
import { CreateMultisig } from "./CreateMultisig"

const members = [1, 2, 3].map(n => {
    const disposable = new Uint8Array(32); disposable[31] = n
    const pubkeyValue = btoa(String.fromCharCode(...secp256k1.getPublicKey(disposable)))
    return { pubkeyValue, address: memberAddress(pubkeyValue) }
})

function fillOffline() {
    fireEvent.change(screen.getByPlaceholderText("e.g. our-super-cool-dao"), { target: { value: "Local rehearsal" } })
    members.forEach((m, i) => {
        fireEvent.change(screen.getByPlaceholderText(`g1member${i + 1}...`), { target: { value: m.address } })
        fireEvent.click(screen.getAllByText("Paste public key")[i])
        fireEvent.change(screen.getByLabelText(`Member ${i + 1} public key`), { target: { value: m.pubkeyValue } })
    })
}

beforeEach(() => {
    vi.clearAllMocks(); config.ENABLE_NATIVE_GNO_MULTISIG = true
    vi.stubGlobal("fetch", vi.fn())
    vi.mocked(api.createOrJoinMultisig).mockImplementation(async req => ({ multisigAddress: req.expectedMultisigAddress, created: true, joined: true }) as never)
})
afterEach(() => vi.unstubAllGlobals())

describe("native multisig registration", () => {
    it("reads a matching member key from native account Data/BaseAccount/public_key", async () => {
        vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ result: { response: { ResponseBase: { Error: null, Data: btoa(JSON.stringify({ BaseAccount: { public_key: { "@type": "/tm.PubKeySecp256k1", value: members[0].pubkeyValue } } })) } } } })))
        render(<CreateMultisig />)
        fireEvent.change(screen.getByPlaceholderText("g1member1..."), { target: { value: members[0].address } })
        fireEvent.click(screen.getAllByText("Fetch Key")[0])
        await screen.findByText("✓ Key")
    })
    it("previews and registers sorted native keys entirely offline", async () => {
        render(<CreateMultisig />); fillOffline()
        const expected = nativeAddress(createNativeMultisig(members, 2))
        expect(screen.getByText(expected)).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Create Multisig" }))
        await screen.findByText(/Configuration registered; nothing was broadcast/)
        const request = vi.mocked(api.createOrJoinMultisig).mock.calls[0][0]
        expect(request.expectedMultisigAddress).toBe(expected)
        expect(request.nativeCreate).toBe(true)
        expect(JSON.parse(request.multisigPubkeyJson!)).toEqual(createNativeMultisig(members, 2))
        expect(fetch).not.toHaveBeenCalled()
    })
    it("keeps production activation held and rejects mismatched address labels", () => {
        config.ENABLE_NATIVE_GNO_MULTISIG = false
        render(<CreateMultisig />); fillOffline()
        expect(screen.getByRole("button", { name: "Create Multisig" })).toBeDisabled()
        expect(api.createOrJoinMultisig).not.toHaveBeenCalled()
    })
    it("does not let an old lookup overwrite an edited member row", async () => {
        let resolve!: (value: Response) => void
        vi.mocked(fetch).mockReturnValue(new Promise(r => { resolve = r }))
        render(<CreateMultisig />)
        const input = screen.getByPlaceholderText("g1member1...")
        fireEvent.change(input, { target: { value: members[0].address } })
        fireEvent.click(screen.getAllByText("Fetch Key")[0])
        fireEvent.change(input, { target: { value: members[1].address } })
        await act(async () => resolve(new Response(JSON.stringify({ result: { response: { ResponseBase: { Value: btoa(JSON.stringify({ pub_key: { value: members[0].pubkeyValue } })) } } } }))))
        await waitFor(() => expect(screen.getAllByText("Fetch Key")[0]).not.toBeDisabled())
        expect(input).toHaveValue(members[1].address)
        expect(screen.queryByText(/🔑/)).not.toBeInTheDocument()
    })
})
