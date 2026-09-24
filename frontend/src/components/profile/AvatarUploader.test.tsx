import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { AvatarUploader } from "./AvatarUploader"

const CID = "bafybei" + "d".repeat(52)
const GATEWAY = `https://gateway.lighthouse.storage/ipfs/${CID}`

vi.mock("../../lib/ipfs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../lib/ipfs")>()
    return {
        ...actual,
        uploadAvatar: vi.fn(async () => ({ cid: CID, url: GATEWAY })),
    }
})

describe("AvatarUploader", () => {
    beforeEach(() => {
        vi.stubGlobal("FileReader", class {
            result = "data:image/png;base64,AAAA"
            onload: (() => void) | null = null
            onerror: (() => void) | null = null
            readAsDataURL() { this.onload?.() }
        })
    })

    it("saves the https gateway URL after an IPFS upload, never ipfs://", async () => {
        const onUrlChange = vi.fn()
        const { container } = render(<AvatarUploader currentUrl="" onUrlChange={onUrlChange} />)
        const input = container.querySelector("input[type=file]") as HTMLInputElement
        fireEvent.change(input, { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } })
        fireEvent.click(await screen.findByTestId("avatar-upload-btn"))
        await waitFor(() => expect(onUrlChange).toHaveBeenCalledWith(GATEWAY))
    })

    it("rewrites an ipfs:// URL typed in URL mode to the gateway URL", () => {
        const onUrlChange = vi.fn()
        render(<AvatarUploader currentUrl="" onUrlChange={onUrlChange} />)
        fireEvent.click(screen.getByTestId("avatar-mode-url"))
        fireEvent.change(screen.getByTestId("avatar-url-input"), { target: { value: `ipfs://${CID}` } })
        fireEvent.click(screen.getByTestId("avatar-apply-url"))
        expect(onUrlChange).toHaveBeenCalledWith(GATEWAY)
    })

    it("refuses a URL the backend would silently drop", () => {
        const onUrlChange = vi.fn()
        render(<AvatarUploader currentUrl="" onUrlChange={onUrlChange} />)
        fireEvent.click(screen.getByTestId("avatar-mode-url"))
        fireEvent.change(screen.getByTestId("avatar-url-input"), { target: { value: "data:image/png;base64,AAAA" } })
        fireEvent.click(screen.getByTestId("avatar-apply-url"))
        expect(onUrlChange).not.toHaveBeenCalled()
        expect(screen.getByText(/Use an https:\/\/ link/)).toBeTruthy()
    })
})
