import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MeetStage } from "./MeetStage"
import MeetWindow from "./native"
import { newRoomId, normaliseRoomId, roomUrl } from "./rooms"
import type { NativeViewProps } from "../../native/types"
import { PhoneShell } from "../../phone/PhoneShell"
import type { OsSession } from "../../shell/useOsSession"
import { SignerContext, type SignerApi } from "../../sign/signerContext"
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

    it("says where the meeting goes when the window is covered, and that closing it leaves", () => {
        render(<MeetWindow {...props({ section: "abc-defg-hij" })} />)
        expect(screen.getByText(/stays connected in a small player while this window is minimised or behind another one\. Closing this window, or locking Memba, leaves the meeting\./)).toBeInTheDocument()
    })

    it("keeps one iframe across minimise and restore, with media permissions", () => {
        const { rerender, container } = render(<MeetStage roomId="abc-defg-hij" placed="" slot={null} minimized={false} foreground={true} restore={vi.fn()} leave={vi.fn()} toast={vi.fn()} />)
        const iframe = container.querySelector("iframe")!
        expect(iframe.getAttribute("allow")).toContain("camera; microphone; display-capture; autoplay; clipboard-write")
        // In front but with no slot (the phone's Notifications sheet took the room's place): the player, never hidden.
        expect(container.querySelector<HTMLElement>(".meet-stage")).toHaveClass("meet-stage-pip")
        expect(container.querySelector<HTMLElement>(".meet-stage")!.style.visibility).toBe("visible")
        expect(screen.getByRole("button", { name: "Leave" })).toBeInTheDocument()
        rerender(<MeetStage roomId="abc-defg-hij" placed="" slot={null} minimized={true} foreground={false} restore={vi.fn()} leave={vi.fn()} toast={vi.fn()} />)
        expect(container.querySelector("iframe")).toBe(iframe)
        expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument()
    })

    it("never hides a connected meeting: behind another window or a dialog it is a small player with Restore and Leave", () => {
        const restore = vi.fn()
        const leave = vi.fn()
        const { container } = render(<MeetStage roomId="abc-defg-hij" placed="" slot={null} minimized={false} foreground={false} restore={restore} leave={leave} toast={vi.fn()} />)
        const stage = container.querySelector<HTMLElement>(".meet-stage")!
        expect(stage).toHaveClass("meet-stage-pip")
        expect(stage.style.visibility).toBe("visible")
        expect(stage).not.toHaveAttribute("aria-hidden", "true")
        expect(screen.getByRole("region", { name: "Meeting abc-defg-hij is still open" })).toBe(stage)
        // Leave is the one control dialogs keep in their Tab cycle; Restore is hidden under a dialog.
        expect(screen.getByRole("button", { name: "Leave" })).toHaveAttribute("data-os-over-dialog")
        expect(screen.getByRole("button", { name: "Restore" })).not.toHaveAttribute("data-os-over-dialog")
        fireEvent.click(screen.getByRole("button", { name: "Restore" }))
        fireEvent.click(screen.getByRole("button", { name: "Leave" }))
        expect(restore).toHaveBeenCalledTimes(1)
        expect(leave).toHaveBeenCalledTimes(1)
    })

    it("sits in its window's slot when in front, and becomes the small player when the slot leaves the view", async () => {
        const desk = document.createElement("div")
        desk.className = "memba-os"
        desk.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 1024, height: 768, right: 1024, bottom: 768, toJSON: () => ({}) })
        const slot = document.createElement("div")
        desk.append(slot)
        document.body.append(desk)
        let box = { left: 10, top: 20, width: 400, height: 300 }
        slot.getBoundingClientRect = () => ({ ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: () => ({}) })
        const at = (placed: string) => <MeetStage roomId="abc-defg-hij" placed={placed} slot={slot} minimized={false} foreground={true} restore={vi.fn()} leave={vi.fn()} toast={vi.fn()} />
        const { container, rerender } = render(at("10 20"))
        const stage = container.querySelector<HTMLElement>(".meet-stage")!
        await waitFor(() => expect(stage.style.width).toBe("400px"))
        expect(stage).not.toHaveClass("meet-stage-pip")
        // Moved with the keyboard: no pointer, resize or animation event, only the window's new place.
        box = { left: 200, top: 20, width: 400, height: 300 }
        rerender(at("200 20"))
        expect(stage.style.left).toBe("200px")
        box = { left: 10, top: 20, width: 400, height: 300 }
        rerender(at("10 20"))
        expect(stage.style.left).toBe("10px")
        expect(stage.style.visibility).toBe("visible")
        expect(screen.queryByRole("button", { name: "Leave" })).toBeNull()

        box = { ...box, height: 0 }
        fireEvent(window, new Event("resize"))
        await waitFor(() => expect(stage).toHaveClass("meet-stage-pip"))
        expect(stage.style.visibility).toBe("visible")

        // A window dragged off the desk: its slot has a size but nothing of it is in the viewport.
        box = { left: -900, top: 20, width: 400, height: 300 }
        fireEvent(window, new Event("resize"))
        await waitFor(() => expect(stage).toHaveClass("meet-stage-pip"))
        box = { left: 10, top: 20, width: 400, height: 300 }
        fireEvent(window, new Event("resize"))
        await waitFor(() => expect(stage).not.toHaveClass("meet-stage-pip"))

        // A thin strip of the room at the desk's edge does not show the meeting: under 120 px wide, or under 90 px high.
        box = { left: 1024 - 119, top: 20, width: 400, height: 300 }
        fireEvent(window, new Event("resize"))
        await waitFor(() => expect(stage).toHaveClass("meet-stage-pip"))
        box = { left: 1024 - 120, top: 20, width: 400, height: 300 }
        fireEvent(window, new Event("resize"))
        await waitFor(() => expect(stage).not.toHaveClass("meet-stage-pip"))
        box = { left: 10, top: 768 - 89, width: 400, height: 300 }
        fireEvent(window, new Event("resize"))
        await waitFor(() => expect(stage).toHaveClass("meet-stage-pip"))
        box = { left: 10, top: 768 - 90, width: 400, height: 300 }
        fireEvent(window, new Event("resize"))
        await waitFor(() => expect(stage).not.toHaveClass("meet-stage-pip"))
        desk.remove()
    })

    it("is placed in its window's slot before the first paint once the slot arrives, neither hidden nor the player on the way", () => {
        const slot = document.createElement("div")
        document.body.append(slot)
        slot.getBoundingClientRect = () => ({ left: 10, top: 20, width: 400, height: 300, x: 10, y: 20, right: 410, bottom: 320, toJSON: () => ({}) })
        // As in the shell: the stage mounts first, the window's slot reaches it on a later render.
        const at = (s: HTMLDivElement | null) => <MeetStage roomId="abc-defg-hij" placed="10 20" slot={s} minimized={false} foreground={true} restore={vi.fn()} leave={vi.fn()} toast={vi.fn()} />
        const { container, rerender } = render(at(null))
        rerender(at(slot))
        const stage = container.querySelector<HTMLElement>(".meet-stage")!
        expect(stage.style.visibility).toBe("visible")
        expect(stage).not.toHaveClass("meet-stage-pip")
        expect(stage.style.width).toBe("400px")
        slot.remove()
    })

    describe("with its window in front, under a dialog", () => {
        const sized = () => {
            const slot = document.createElement("div")
            slot.getBoundingClientRect = () => ({ left: 10, top: 20, width: 400, height: 300, x: 10, y: 20, right: 410, bottom: 320, toJSON: () => ({}) })
            return slot
        }
        const inOs = (leave = vi.fn()) => {
            const os = document.createElement("div")
            os.className = "memba-os"
            document.body.append(os)
            const slot = sized()
            os.append(slot)
            const view = render(<MeetStage roomId="abc-defg-hij" placed="10 20" slot={slot} minimized={false} foreground={true} restore={vi.fn()} leave={leave} toast={vi.fn()} />, { container: os })
            return { os, stage: () => os.querySelector<HTMLElement>(".meet-stage")!, ...view }
        }
        afterEach(() => { document.querySelectorAll(".memba-os").forEach((el) => el.remove()) })

        it.each([
            ["the shell's own (Connect, the launcher, the signing sheet: a scrim)", () => Object.assign(document.createElement("div"), { className: "os-scrim" })],
            ["a native modal one (Settings' reset dialog)", () => { const d = document.createElement("dialog"); d.setAttribute("open", ""); return d }],
        ])("is the small player, never full size behind %s", async (_kind, make) => {
            const { os, stage } = inOs()
            expect(stage()).not.toHaveClass("meet-stage-pip")
            const dialog = make()
            os.append(dialog)
            await waitFor(() => expect(stage()).toHaveClass("meet-stage-pip"))
            expect(screen.getByRole("button", { name: "Leave" })).toHaveAttribute("data-os-over-dialog")
            dialog.remove()
            await waitFor(() => expect(stage()).not.toHaveClass("meet-stage-pip"))
        })

        it("gives focus back to the dialog when Leave is pressed over it", async () => {
            const leave = vi.fn()
            const { os, stage } = inOs(leave)
            const scrim = Object.assign(document.createElement("div"), { className: "os-scrim" })
            const dialog = Object.assign(document.createElement("div"), { tabIndex: -1 })
            dialog.setAttribute("role", "dialog")
            dialog.setAttribute("aria-modal", "true")
            scrim.append(dialog)
            os.append(scrim)
            await waitFor(() => expect(stage()).toHaveClass("meet-stage-pip"))
            const button = screen.getByRole("button", { name: "Leave" })
            button.focus()
            fireEvent.click(button)
            expect(leave).toHaveBeenCalledOnce()
            expect(dialog).toHaveFocus()
        })
    })

    it("closes the phone's Notifications sheet when the player's Restore asks for the room", () => {
        const signer: SignerApi = { sign: vi.fn(), pending: [], notices: [], unread: 0, markRead: vi.fn(), version: 0 }
        const session = { status: "guest", network: { chainId: "gnoland-1", isTestnet: false }, openConnect: vi.fn(), layout: { auth: { token: null, isAuthenticated: false } } } as unknown as OsSession
        const client = new QueryClient()
        const phone = (sheetReset: number) => (
            <QueryClientProvider client={client}><SignerContext.Provider value={signer}>
                <PhoneShell locked={false} session={session} front={null} items={[]} open={vi.fn()} openApp={vi.fn()} openItem={vi.fn()}
                    close={vi.fn()} home={vi.fn()} toast={vi.fn()} openSearch={vi.fn()} sheetReset={sheetReset} />
            </SignerContext.Provider></QueryClientProvider>
        )
        const { rerender } = render(phone(0))
        fireEvent.click(screen.getByRole("button", { name: "Notifications" }))
        expect(screen.getByRole("region", { name: "Notifications" })).toBeInTheDocument()
        // The same request again changes nothing; Shell bumps it on Restore.
        rerender(phone(0))
        expect(screen.getByRole("region", { name: "Notifications" })).toBeInTheDocument()
        rerender(phone(1))
        expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull()
        expect(screen.getByRole("main", { name: "Home" })).toBeInTheDocument()
    })
})

describe("full screen during a meeting", () => {
    const exit = vi.fn(() => Promise.resolve())
    const toast = vi.fn()
    const setFullscreen = (element: Element | null) => {
        Object.defineProperty(document, "fullscreenElement", { configurable: true, value: element })
        fireEvent(document, new Event("fullscreenchange"))
    }
    const stage = () => render(<MeetStage roomId="abc-defg-hij" placed="" slot={null} minimized={false} foreground={false} restore={vi.fn()} leave={vi.fn()} toast={toast} />)
    beforeEach(() => {
        exit.mockClear()
        toast.mockClear()
        Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exit })
    })
    afterEach(() => {
        Reflect.deleteProperty(document, "fullscreenElement")
        Reflect.deleteProperty(document, "exitFullscreen")
        Reflect.deleteProperty(document, "webkitFullscreenElement")
        Reflect.deleteProperty(document, "webkitExitFullscreen")
    })

    it("leaves full screen when another element takes it, so the live meeting is not covered", () => {
        stage()
        const other = document.createElement("div")
        document.body.append(other)
        // The browser may refuse: the rejection is handled.
        const refused = Promise.reject(new Error("refused"))
        const handled = vi.spyOn(refused, "catch")
        exit.mockImplementationOnce(() => refused)
        setFullscreen(other)
        expect(exit).toHaveBeenCalledTimes(1)
        expect(handled).toHaveBeenCalledTimes(1)
        // The member is told why the screen came back, once, however many events the browser sends for it.
        expect(toast).toHaveBeenCalledWith("Another window can't take full screen while a meeting is live here.")
        fireEvent(document, new Event("fullscreenchange"))
        fireEvent(document, new Event("webkitfullscreenchange"))
        expect(exit).toHaveBeenCalledTimes(1)
        expect(toast).toHaveBeenCalledTimes(1)
        setFullscreen(null)
        expect(exit).toHaveBeenCalledTimes(1)
        // The next time another element takes the screen, it is left again.
        setFullscreen(other)
        expect(exit).toHaveBeenCalledTimes(2)
        expect(toast).toHaveBeenCalledTimes(2)
        other.remove()
    })

    it("does the same where only the prefixed full-screen API exists", () => {
        Reflect.deleteProperty(document, "exitFullscreen")
        const prefixedExit = vi.fn()
        Object.defineProperty(document, "webkitExitFullscreen", { configurable: true, value: prefixedExit })
        stage()
        const other = document.createElement("div")
        document.body.append(other)
        Object.defineProperty(document, "webkitFullscreenElement", { configurable: true, value: other })
        fireEvent(document, new Event("webkitfullscreenchange"))
        expect(prefixedExit).toHaveBeenCalledTimes(1)
        expect(toast).toHaveBeenCalledTimes(1)
        other.remove()
    })

    it("stays in full screen when the meeting itself is the full-screen element", () => {
        const { container } = stage()
        setFullscreen(container.querySelector("iframe"))
        expect(exit).not.toHaveBeenCalled()
        expect(toast).not.toHaveBeenCalled()
    })

    it("leaves a full screen that was already on when the meeting starts", () => {
        const other = document.createElement("div")
        document.body.append(other)
        setFullscreen(other)
        stage()
        expect(exit).toHaveBeenCalledTimes(1)
        other.remove()
    })

    it("stops watching once the meeting is closed", () => {
        const { unmount } = stage()
        unmount()
        setFullscreen(document.body)
        expect(exit).not.toHaveBeenCalled()
    })
})
