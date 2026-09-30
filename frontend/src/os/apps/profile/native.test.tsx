import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithProviders } from "../../../test/test-utils"
import type { SignRequest } from "../../sign/signer"

const OWNER = "g1manfred47kzduec920z88wfr64ylksmdcedlf5"
const sign = vi.fn<(request: SignRequest) => void>()
const price = vi.fn()

vi.mock("../../../lib/config", async (original) => ({ ...(await original<typeof import("../../../lib/config")>()), getUsernameRegistrarPath: () => "gno.land/r/sys/namereg/v0" }))
vi.mock("../../../lib/grc20", async (original) => ({ ...(await original<typeof import("../../../lib/grc20")>()), networkGasPriceFresh: () => price() }))
vi.mock("../../../lib/profile", () => ({ fetchUserProfile: vi.fn(async () => { throw new Error("offline") }) }))
vi.mock("../../../lib/usernameRegistration", async (original) => ({ ...(await original<typeof import("../../../lib/usernameRegistration")>()), fetchRegisterPrice: vi.fn(async () => 0n) }))
vi.mock("../../../components/profile/AvatarUploader", () => ({ AvatarUploader: () => null }))
vi.mock("../../sign/signerContext", () => ({ useSigner: () => ({ sign, version: 0 }) }))
vi.mock("../../profile/ProfileCanvas", () => ({ ProfileCanvas: () => <div data-testid="canvas" /> }))
vi.mock("../../profile/profilePublish", async (original) => ({ ...(await original<typeof import("../../profile/profilePublish")>()), profilePublishEnabled: true }))
vi.mock("../../profile/profileData", async (original) => {
    const actual = await original<typeof import("../../profile/profileData")>()
    return {
        ...actual,
        readProfileOnChain: vi.fn(async () => ({
            core: { displayName: "Alice", bio: "Hi", avatar: null, homepage: null, location: null },
            document: actual.defaultProfileDocument(), documentPresent: false, documentProblem: false, missingCore: [],
        })),
    }
})

import ProfileWindow from "./native"

// Twice the fallback price, so a request built on the fallback would show another fee.
const CHAIN_PRICE = { gas: 1000, ugnot: 2 }
const session = { status: "member", address: OWNER, network: { key: "mainnet", label: "gno.land", chainId: "gnoland-1" }, openConnect: vi.fn() } as never
const open = () => renderWithProviders(<ProfileWindow section={null} session={session} open={vi.fn()} openApp={vi.fn()} close={vi.fn()} toast={vi.fn()} fallback={null} />)

describe("Profile window: the fee is quoted from the chain at every review", () => {
    beforeEach(() => { sign.mockReset(); price.mockReset(); localStorage.clear() })

    it("opens a publish review on a fresh price, and stops before the sheet when a later read fails", async () => {
        price.mockResolvedValueOnce(CHAIN_PRICE)
        open()
        fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }))
        fireEvent.change(screen.getByRole("textbox", { name: "Bio" }), { target: { value: "Hello Gno" } })
        fireEvent.click(screen.getByRole("button", { name: "Review & publish 1 change" }))
        await waitFor(() => expect(sign).toHaveBeenCalledTimes(1))
        expect(sign.mock.calls[0][0].lines(undefined)).toContainEqual(["Network fee", "0.0336 GNOT"])

        // The earlier price must not be reused: the chain no longer answers.
        price.mockRejectedValueOnce(new Error("offline"))
        fireEvent.click(await screen.findByRole("button", { name: "Review & publish 1 change" }))
        expect(await screen.findByText("The network fee could not be read. Try again in a moment.")).toBeInTheDocument()
        expect(sign).toHaveBeenCalledTimes(1)
    })

    it("does the same for a username registration", async () => {
        price.mockResolvedValueOnce(CHAIN_PRICE)
        open()
        fireEvent.change(await screen.findByRole("textbox", { name: "Username" }), { target: { value: "nym-builder042" } })
        fireEvent.click(screen.getByRole("button", { name: "Review registration" }))
        await waitFor(() => expect(sign).toHaveBeenCalledTimes(1))
        expect(sign.mock.calls[0][0].lines(undefined)).toContainEqual(["Network fee", "0.216 GNOT"])

        price.mockRejectedValueOnce(new Error("offline"))
        fireEvent.click(await screen.findByRole("button", { name: "Review registration" }))
        expect(await screen.findByRole("alert")).toHaveTextContent("The network fee could not be read. Try again in a moment.")
        expect(sign).toHaveBeenCalledTimes(1)
    })

    it("asks for one publish review while the fee is read, with the fields inert and the button still focusable", async () => {
        let answer: (value: typeof CHAIN_PRICE) => void = () => {}
        price.mockReturnValue(new Promise((resolve) => { answer = resolve }))
        open()
        fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }))
        const bio = screen.getByRole("textbox", { name: "Bio" })
        fireEvent.change(bio, { target: { value: "Hello Gno" } })
        fireEvent.click(screen.getByRole("button", { name: "Review & publish 1 change" }))
        const waiting = await screen.findByRole("button", { name: "Checking fee…" })
        expect(waiting).toHaveAttribute("aria-disabled", "true")
        expect(waiting).toBeEnabled()
        expect(waiting.closest("[inert]")).toBeNull()
        expect(bio.closest("[inert]")).not.toBeNull()
        fireEvent.click(waiting)
        fireEvent.click(waiting)
        expect(price).toHaveBeenCalledTimes(1)
        await act(async () => { answer(CHAIN_PRICE) })
        expect(sign).toHaveBeenCalledTimes(1)
        expect(screen.getByRole("textbox", { name: "Bio" }).closest("[inert]")).toBeNull()
    })

    it("opens no publish review for an editor that closed while the fee was read", async () => {
        let answer: (value: typeof CHAIN_PRICE) => void = () => {}
        price.mockReturnValue(new Promise((resolve) => { answer = resolve }))
        open()
        fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }))
        fireEvent.change(screen.getByRole("textbox", { name: "Bio" }), { target: { value: "Hello Gno" } })
        fireEvent.click(screen.getByRole("button", { name: "Review & publish 1 change" }))
        // "View published" is outside the inert fields: it closes the editor mid-read.
        fireEvent.click(screen.getByRole("button", { name: "View published" }))
        await act(async () => { answer(CHAIN_PRICE) })
        expect(sign).not.toHaveBeenCalled()
    })

    it("locks the username while its registration fee is read, and asks for one review", async () => {
        let answer: (value: typeof CHAIN_PRICE) => void = () => {}
        price.mockReturnValue(new Promise((resolve) => { answer = resolve }))
        open()
        const name = await screen.findByRole("textbox", { name: "Username" })
        fireEvent.change(name, { target: { value: "nym-builder042" } })
        fireEvent.click(screen.getByRole("button", { name: "Review registration" }))
        const waiting = await screen.findByRole("button", { name: "Checking price…" })
        expect(waiting).toHaveAttribute("aria-disabled", "true")
        expect(waiting).toBeEnabled()
        expect(name).toBeDisabled()
        fireEvent.click(waiting)
        await act(async () => { answer(CHAIN_PRICE) })
        await waitFor(() => expect(sign).toHaveBeenCalledTimes(1))
        expect(price).toHaveBeenCalledTimes(1)
        expect(sign.mock.calls[0][0].summary).toBe("Register @nym-builder042")
    })
})
