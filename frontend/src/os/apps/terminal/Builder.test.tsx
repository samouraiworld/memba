import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Builder } from "./Builder"

vi.mock("./CodeEditor", () => ({
    MAX_SOURCE_BYTES: 32_768,
    CodeEditor: ({ value }: { value: string }) => <textarea aria-label="Gno source editor" value={value} readOnly />,
}))

const key = "memba_os_terminal_draft:gnoland-1:guest"
const oldDraft = JSON.stringify({ path: "gno.land/r/yourname/old", source: "package old\n" })
const newDraft = JSON.stringify({ path: "gno.land/r/yourname/new", source: "package new\n" })

beforeEach(() => {
    localStorage.clear()
    localStorage.setItem(key, oldDraft)
})

afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
})

describe("Terminal draft startup sync", () => {
    it("catches a write between the render-time read and storage subscription", () => {
        const getItem = localStorage.getItem.bind(localStorage)
        const setItem = localStorage.setItem.bind(localStorage)
        let firstRead = true
        vi.spyOn(localStorage, "getItem").mockImplementation((name) => {
            const raw = getItem(name)
            if (name === key && firstRead) {
                firstRead = false
                // Same-document writes emit no storage event, reproducing a
                // second tab's write that arrived before the listener existed.
                setItem(key, newDraft)
            }
            return raw
        })

        render(<Builder chainId="gnoland-1" address="" />)
        expect(firstRead).toBe(false)
        expect(getItem(key)).toBe(newDraft)
        expect(screen.getByRole("textbox", { name: "Realm path" })).toHaveValue("gno.land/r/yourname/new")
        expect(screen.getByRole("textbox", { name: "Gno source editor" })).toHaveValue("package new\n")
    })

    it("keeps an unsaved local draft when storage failed before an external write", () => {
        const getItem = localStorage.getItem.bind(localStorage)
        const setItem = localStorage.setItem.bind(localStorage)
        let firstRead = true
        vi.spyOn(localStorage, "getItem").mockImplementation((name) => {
            if (name === key && firstRead) {
                firstRead = false
                setItem(key, newDraft)
                throw new DOMException("Storage unavailable", "SecurityError")
            }
            return getItem(name)
        })

        render(<Builder chainId="gnoland-1" address="" />)
        expect(firstRead).toBe(false)
        expect(getItem(key)).toBe(newDraft)
        expect(screen.getByRole("textbox", { name: "Realm path" })).toHaveValue("gno.land/r/yourname/hello")
        expect(screen.getByRole("alert")).toHaveTextContent("changed in another tab")
        expect(screen.getByText("Edits in this tab are unsaved")).toBeInTheDocument()
    })
})
