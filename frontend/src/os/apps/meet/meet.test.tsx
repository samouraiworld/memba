import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { MeetStage } from "./MeetStage"
import MeetWindow from "./native"
import { newRoomId, normaliseRoomId, roomUrl } from "./rooms"
import type { NativeViewProps } from "../../native/types"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

describe("Meet room links", () => {
    it("generates 3-4-3 invite secrets using browser crypto", () => {
        const ids = Array.from({ length: 50 }, newRoomId)
        expect(ids.every((id) => /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(id))).toBe(true)
        expect(new Set(ids).size).toBe(ids.length)
    })

    it("accepts codes and Visio invites only", () => {
        expect(normaliseRoomId("ABCdefgHIJ")).toBe("abc-defg-hij")
        expect(normaliseRoomId("ab1-cd2e-fg3")).toBe("ab1-cd2e-fg3")
        expect(normaliseRoomId("https://visio.samourai.app/abc-defg-hij/")).toBe("abc-defg-hij")
        expect(normaliseRoomId("https://evil.example/abc-defg-hij")).toBeNull()
        expect(normaliseRoomId("https://visio.samourai.app/abc-defg-hij?x=1")).toBeNull()
        expect(normaliseRoomId("meeting-name")).toBeNull()
        expect(roomUrl("abc-defg-hij")).toBe("https://visio.samourai.app/abc-defg-hij")
    })
})

describe("embedding policy", () => {
    it("allows Visio in both CSPs and keeps the existing Jitsi sources", () => {
        const here = dirname(fileURLToPath(import.meta.url))
        const netlify = readFileSync(resolve(here, "../../../../../netlify.toml"), "utf8")
        const html = readFileSync(resolve(here, "../../../../index.html"), "utf8")
        for (const source of [netlify, html]) {
            const frame = source.match(/frame-src (https:[^;]+);/)?.[1] ?? ""
            expect(frame).toContain("https://visio.samourai.app")
            expect(frame).toContain("https://meet.jit.si")
            expect(frame).toContain("https://8x8.vc")
        }
        expect(netlify).toMatch(/Permissions-Policy.*camera=.*https:\/\/meet\.jit\.si.*https:\/\/visio\.samourai\.app/)
    })
})

const props = (overrides: Partial<NativeViewProps> = {}): NativeViewProps => ({
    section: null, session: {} as NativeViewProps["session"], active: true, open: vi.fn(), push: vi.fn(), openApp: vi.fn(),
    close: vi.fn(), toast: vi.fn(), fallback: null, ...overrides,
})

describe("Meet window", () => {
    it("lets guests start or join a meeting without a wallet action", () => {
        const open = vi.fn()
        render(<MeetWindow {...props({ open })} />)
        fireEvent.change(screen.getByLabelText("Have an invitation?"), { target: { value: "abc-defg-hij" } })
        fireEvent.click(screen.getByRole("button", { name: "Join meeting" }))
        expect(open).toHaveBeenCalledWith(expect.objectContaining({ app: "meet", target: { kind: "app", app: "meet", section: "abc-defg-hij" } }))
    })

    it("keeps an explicit pop-out when the iframe is blocked", () => {
        render(<MeetWindow {...props({ section: "abc-defg-hij" })} />)
        expect(screen.getByRole("link", { name: /Open in Visio/ })).toHaveAttribute("href", roomUrl("abc-defg-hij"))
        expect(screen.getByText(/If the meeting stays blank/)).toBeInTheDocument()
    })

    it("keeps one iframe across minimise and restore, with media permissions", () => {
        const { rerender, container } = render(<MeetStage roomId="abc-defg-hij" slot={null} minimized={false} foreground={true} restore={vi.fn()} />)
        const iframe = container.querySelector("iframe")!
        expect(iframe.getAttribute("allow")).toContain("camera; microphone; display-capture; autoplay; clipboard-write")
        rerender(<MeetStage roomId="abc-defg-hij" slot={null} minimized={true} foreground={false} restore={vi.fn()} />)
        expect(container.querySelector("iframe")).toBe(iframe)
        expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument()
    })
})
