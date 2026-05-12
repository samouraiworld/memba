/**
 * Tests for PageMeta — document.title + og:title side-effects with race-safe cleanup.
 *
 * @module components/gnolove/PageMeta.test
 */

import { describe, it, expect, beforeEach } from "vitest"
import { render } from "@testing-library/react"
import { PageMeta } from "./PageMeta"

describe("PageMeta", () => {
    beforeEach(() => {
        document.title = "Original Title"
        // Reset OG meta tags between tests
        document.querySelectorAll('meta[property^="og:"], meta[name="twitter:title"], meta[name="description"]')
            .forEach(el => el.remove())
    })

    it("sets document.title on mount", () => {
        render(<PageMeta title="My Page" />)
        expect(document.title).toBe("My Page")
    })

    it("restores previous title on unmount when title still matches", () => {
        const { unmount } = render(<PageMeta title="My Page" />)
        expect(document.title).toBe("My Page")
        unmount()
        expect(document.title).toBe("Original Title")
    })

    it("does NOT clobber a title another component already changed [MF-10 race-safe]", () => {
        const { unmount } = render(<PageMeta title="My Page" />)
        // Simulate a sibling component changing the title.
        document.title = "Sibling's Title"
        unmount()
        // Cleanup must not restore "Original Title" — that would overwrite the sibling.
        expect(document.title).toBe("Sibling's Title")
    })

    it("creates og:title and twitter:title meta tags", () => {
        render(<PageMeta title="My Page" />)
        const og = document.querySelector('meta[property="og:title"]')
        const tw = document.querySelector('meta[name="twitter:title"]')
        expect(og?.getAttribute("content")).toBe("My Page")
        expect(tw?.getAttribute("content")).toBe("My Page")
    })

    it("removes meta tags it created on unmount", () => {
        const { unmount } = render(<PageMeta title="My Page" />)
        expect(document.querySelector('meta[property="og:title"]')).not.toBeNull()
        unmount()
        expect(document.querySelector('meta[property="og:title"]')).toBeNull()
    })

    it("sets meta description when provided", () => {
        render(<PageMeta title="My Page" description="A test page" />)
        const desc = document.querySelector('meta[name="description"]')
        expect(desc?.getAttribute("content")).toBe("A test page")
    })
})
