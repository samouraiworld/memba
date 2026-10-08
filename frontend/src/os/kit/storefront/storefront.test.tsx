import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AppIcon, CoverCapsule, HeroCarousel, MediaGallery, RatingBadge, monogram, type HeroSlide } from "."

const slide = (id: string, onClick = vi.fn()): HeroSlide => ({ id, kicker: "Featured", title: id, pitch: `${id} pitch`, cover: null, accent: "#123", tags: ["Tag"], primary: { label: `Play ${id}`, onClick } })
// jsdom has no matchMedia, so install one for the test and remove it in afterEach.
const reduced = (matches: boolean) => Object.defineProperty(window, "matchMedia", {
    configurable: true, writable: true,
    value: vi.fn((query: string) => ({ matches, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })),
})

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); Reflect.deleteProperty(window, "matchMedia") })

describe("HeroCarousel", () => {
    it("advances every 7 s and lets the picker choose a slide", () => {
        vi.useFakeTimers(); reduced(false)
        render(<HeroCarousel label="Featured games" slides={[slide("ONE"), slide("TWO")]} />)
        expect(screen.getByRole("heading", { name: "ONE" })).toBeInTheDocument()
        act(() => { vi.advanceTimersByTime(7000) })
        expect(screen.getByRole("heading", { name: "TWO" })).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "ONE" }))
        expect(screen.getByRole("heading", { name: "ONE" })).toBeInTheDocument()
    })
    it("never autoplays with reduced motion, or while the window is in the background", () => {
        vi.useFakeTimers(); reduced(true)
        const { rerender } = render(<HeroCarousel label="Featured" slides={[slide("ONE"), slide("TWO")]} />)
        act(() => { vi.advanceTimersByTime(30_000) })
        expect(screen.getByRole("heading", { name: "ONE" })).toBeInTheDocument()
        reduced(false)
        rerender(<HeroCarousel label="Featured" slides={[slide("ONE"), slide("TWO")]} active={false} />)
        act(() => { vi.advanceTimersByTime(30_000) })
        expect(screen.getByRole("heading", { name: "ONE" })).toBeInTheDocument()
    })
    it("stays paused while hovered and resumes on leave", () => {
        vi.useFakeTimers(); reduced(false)
        render(<HeroCarousel label="Featured" slides={[slide("ONE"), slide("TWO")]} />)
        const region = screen.getByRole("region", { name: "Featured" })
        fireEvent.mouseEnter(region)
        act(() => { vi.advanceTimersByTime(7000) })
        expect(screen.getByRole("heading", { name: "ONE" })).toBeInTheDocument()
        fireEvent.mouseLeave(region)
        act(() => { vi.advanceTimersByTime(7000) })
        expect(screen.getByRole("heading", { name: "TWO" })).toBeInTheDocument()
    })
    it("moves with the arrow keys and runs the slide action", () => {
        reduced(true)
        const play = vi.fn()
        render(<HeroCarousel label="Featured" slides={[slide("ONE", play), slide("TWO")]} />)
        fireEvent.click(screen.getByRole("button", { name: "Play ONE" }))
        expect(play).toHaveBeenCalledOnce()
        fireEvent.keyDown(screen.getByRole("region", { name: "Featured" }), { key: "ArrowRight" })
        expect(screen.getByRole("heading", { name: "TWO" })).toBeInTheDocument()
    })
})

describe("CoverCapsule", () => {
    it("opens details and plays from two separate buttons", () => {
        const onOpen = vi.fn(), onPlay = vi.fn()
        render(<CoverCapsule title="BARRICADE" pitch="Defend" cover={null} accent="#000" tags={["Strategy"]} costTag={{ label: "Free", tone: "free" }} onOpen={onOpen} onPlay={onPlay} />)
        fireEvent.click(screen.getByRole("button", { name: "Details for BARRICADE" }))
        fireEvent.click(screen.getByRole("button", { name: "Play BARRICADE" }))
        expect(onOpen).toHaveBeenCalledOnce(); expect(onPlay).toHaveBeenCalledOnce()
    })
    it("offers no Play button on a disabled capsule, but keeps its details live", () => {
        const onOpen = vi.fn()
        render(<CoverCapsule title="BARRICADE" pitch="Defend" cover={null} accent="#000" tags={["Strategy"]} costTag={{ label: "Free", tone: "free" }} onOpen={onOpen} onPlay={vi.fn()} disabled />)
        expect(screen.queryByRole("button", { name: "Play BARRICADE" })).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Details for BARRICADE" }))
        expect(onOpen).toHaveBeenCalledOnce()
    })
    it("describes the details button with the pitch, tags and cost", () => {
        render(<CoverCapsule title="BARRICADE" pitch="Defend the gate" cover={null} accent="#000" tags={["Strategy"]} costTag={{ label: "Free", tone: "free" }} onOpen={vi.fn()} />)
        const details = screen.getByRole("button", { name: "Details for BARRICADE" })
        expect(details).toHaveAccessibleDescription(expect.stringContaining("Defend the gate"))
        expect(details).toHaveAccessibleDescription(expect.stringContaining("Strategy"))
    })
    it("links out when external, with the given name", () => {
        render(<CoverCapsule title="gnofly" pitch="Fly" cover={null} accent="#000" tags={[]} costTag={{ label: "External", tone: "warn" }} href="https://gnofly.xyz/" linkLabel="Visit gnofly (opens in a new tab)" />)
        const link = screen.getByRole("link", { name: "Visit gnofly (opens in a new tab)" })
        expect(link).toHaveAttribute("target", "_blank"); expect(link).toHaveAttribute("rel", "noopener noreferrer")
    })
})

describe("RatingBadge", () => {
    it("hides an average below 3 reviews and shows it from 3", () => {
        const { rerender, container } = render(<RatingBadge summary={undefined} />)
        expect(container).toBeEmptyDOMElement()
        rerender(<RatingBadge summary={{ count: 2, sum: 10, average: 5 }} />)
        expect(screen.getByText("New")).toBeInTheDocument()
        rerender(<RatingBadge summary={{ count: 4, sum: 18, average: 4.5 }} />)
        expect(screen.getByText("Rated 4.5 out of 5 from 4 reviews")).toBeInTheDocument()
    })
})

describe("AppIcon and MediaGallery", () => {
    it("falls back to a monogram", () => {
        render(<AppIcon name="Gno Playground" logo={null} accent="#000" />)
        expect(screen.getByText("GP")).toBeInTheDocument()
        expect(monogram("Adena")).toBe("AD")
    })
    it("shows one screenshot at a time and switches from the thumbnails", () => {
        render(<MediaGallery name="GnoSwap" images={["/a.webp", "/b.webp"]} />)
        expect(screen.getByAltText("GnoSwap screenshot 1")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Show GnoSwap screenshot 2" }))
        expect(screen.getByAltText("GnoSwap screenshot 2")).toBeInTheDocument()
    })
    it("renders nothing without images", () => {
        const { container } = render(<MediaGallery name="X" images={[]} />)
        expect(container).toBeEmptyDOMElement()
    })
})
