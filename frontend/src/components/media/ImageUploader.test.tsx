import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the IPFS lib so no network happens — but keep the REAL isValidImageMime so the
// component's client-side non-image rejection is exercised for real.
const uploadImage = vi.fn()
vi.mock("../../lib/ipfs", async (importActual) => {
    const actual = await importActual<typeof import("../../lib/ipfs")>()
    return { ...actual, uploadImage: (...a: unknown[]) => uploadImage(...a) }
})

const { ImageUploader } = await import("./ImageUploader")

const BARE_CID = "bafybei" + "d".repeat(52)

function pick(testId: string, file: File) {
    const input = screen.getByTestId(testId) as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
}

beforeEach(() => {
    uploadImage.mockReset().mockResolvedValue(BARE_CID)
})

describe("ImageUploader", () => {
    it("uploads a valid image and emits the BARE CID", async () => {
        const onUploaded = vi.fn()
        render(<ImageUploader label="Icon" testIdPrefix="ic" onUploaded={onUploaded} />)

        pick("ic-input", new File(["icon"], "icon.png", { type: "image/png" }))

        await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(BARE_CID))
        // Emitted value is a bare CID — never ipfs://-prefixed or a URL.
        const emitted = onUploaded.mock.calls[0][0] as string
        expect(emitted).toBe(BARE_CID)
        expect(emitted.startsWith("ipfs://")).toBe(false)
        expect(emitted.startsWith("http")).toBe(false)
        expect(screen.getByTestId("ic-cid")).toBeInTheDocument()
    })

    it("client-rejects a non-image (SVG) without calling uploadImage", async () => {
        const onUploaded = vi.fn()
        render(<ImageUploader label="Icon" testIdPrefix="ic" onUploaded={onUploaded} />)

        pick("ic-input", new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }))

        await waitFor(() => expect(screen.getByTestId("ic-error")).toBeInTheDocument())
        expect(uploadImage).not.toHaveBeenCalled()
        expect(onUploaded).not.toHaveBeenCalled()
    })

    it("surfaces an upload error and does not emit a CID", async () => {
        const onUploaded = vi.fn()
        uploadImage.mockRejectedValueOnce(new Error("Upload failed (401): authorization required"))
        render(<ImageUploader label="Screenshot" testIdPrefix="ss" onUploaded={onUploaded} />)

        pick("ss-input", new File(["shot"], "shot.png", { type: "image/png" }))

        await waitFor(() => expect(screen.getByTestId("ss-error")).toHaveTextContent(/authorization required/i))
        expect(onUploaded).not.toHaveBeenCalled()
    })
})
