import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AccountContext, SIGNED_OUT } from "../../account/accountContext"
import { AdminPanelLink } from "./AdminPanelLink"

describe("the admin panel link", () => {
    it("shows only to a signed-in admin, and never asks for a sign-in itself", () => {
        const user = { id: "u", email: null, fullName: null, isAdmin: false }
        const { rerender, container } = render(<AdminPanelLink />)
        expect(container).toBeEmptyDOMElement()
        rerender(<AccountContext.Provider value={{ ...SIGNED_OUT, status: "ready", user }}><AdminPanelLink /></AccountContext.Provider>)
        expect(container).toBeEmptyDOMElement()
        rerender(<AccountContext.Provider value={{ ...SIGNED_OUT, status: "ready", user: { ...user, isAdmin: true } }}><AdminPanelLink /></AccountContext.Provider>)
        expect(screen.getByRole("link", { name: /Admin Panel/ })).toHaveAttribute("href", "https://panel.memba.samourai.app")
    })
})
