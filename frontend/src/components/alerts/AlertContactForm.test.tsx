/**
 * Covers the refusal path. gnomonitoring's hardened /alert-contacts endpoints
 * answer with a plain-text reason ("Webhook not found", "Missing required
 * fields"); dropping it is what made this whole class of bug undiagnosable
 * from the UI.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, cleanup, fireEvent, waitFor, screen } from "@testing-library/react"
import type { AlertContact, MonitoringWebhook } from "../../lib/monitoringAuth"
import { AlertContactForm } from "./AlertContactForm"

const webhook = (id: number): MonitoringWebhook => ({
    ID: id,
    URL: "https://discord.com/api/webhooks/abc",
    Type: "discord",
    Description: `hook-${id}`,
    ChainID: "topaz-1",
})

const contact = (): AlertContact => ({
    ID: 1, Moniker: "val-1", NameContact: "On-call", MentionTag: "123", IDwebhook: 5,
})

function fill(moniker: string, name: string, tag: string) {
    fireEvent.change(document.querySelector("#contact-moniker")!, { target: { value: moniker } })
    fireEvent.change(document.querySelector("#contact-name")!, { target: { value: name } })
    fireEvent.change(document.querySelector("#contact-mention")!, { target: { value: tag } })
}

describe("AlertContactForm refusals", () => {
    afterEach(() => { cleanup(); vi.clearAllMocks() })

    it("shows the server's reason when the add is refused", async () => {
        const onAdd = vi.fn().mockResolvedValue({ ok: false, error: "Webhook not found" })
        render(
            <AlertContactForm
                contacts={[]} webhooks={[webhook(5)]}
                onAdd={onAdd} onUpdate={vi.fn()} onDelete={vi.fn()}
            />,
        )
        fill("val-1", "On-call", "123456789012345678")
        fireEvent.click(screen.getByText("Add Contact", { selector: "button" }))

        await waitFor(() => expect(screen.getByText("Webhook not found")).toBeTruthy())
    })

    it("keeps the typed values on refusal so they are not retyped", async () => {
        const onAdd = vi.fn().mockResolvedValue({ ok: false, error: "Missing required fields" })
        render(
            <AlertContactForm
                contacts={[]} webhooks={[webhook(5)]}
                onAdd={onAdd} onUpdate={vi.fn()} onDelete={vi.fn()}
            />,
        )
        fill("val-1", "On-call", "123456789012345678")
        fireEvent.click(screen.getByText("Add Contact", { selector: "button" }))

        await waitFor(() => expect(screen.getByText("Missing required fields")).toBeTruthy())
        expect(document.querySelector<HTMLInputElement>("#contact-moniker")!.value).toBe("val-1")
    })

    it("clears the form and the error on success", async () => {
        const onAdd = vi.fn().mockResolvedValue({ ok: true })
        render(
            <AlertContactForm
                contacts={[]} webhooks={[webhook(5)]}
                onAdd={onAdd} onUpdate={vi.fn()} onDelete={vi.fn()}
            />,
        )
        fill("val-1", "On-call", "123456789012345678")
        fireEvent.click(screen.getByText("Add Contact", { selector: "button" }))

        await waitFor(() =>
            expect(document.querySelector<HTMLInputElement>("#contact-moniker")!.value).toBe(""))
        expect(screen.queryByText("Webhook not found")).toBeNull()
    })

    it("shows the reason when an edit is refused", async () => {
        const onUpdate = vi.fn().mockResolvedValue({ ok: false, error: "Alert contact not found" })
        render(
            <AlertContactForm
                contacts={[contact()]} webhooks={[webhook(5)]}
                onAdd={vi.fn()} onUpdate={onUpdate} onDelete={vi.fn()}
            />,
        )
        fireEvent.click(screen.getByText("Edit"))
        fireEvent.click(screen.getByText("Update", { selector: "button" }))

        await waitFor(() => expect(screen.getByText("Alert contact not found")).toBeTruthy())
    })
})

describe("AlertContactForm webhook selector", () => {
    afterEach(() => { cleanup(); vi.clearAllMocks() })

    it("submits the selected webhook id", async () => {
        const onAdd = vi.fn().mockResolvedValue({ ok: true })
        render(
            <AlertContactForm
                contacts={[]} webhooks={[webhook(3), webhook(9)]}
                onAdd={onAdd} onUpdate={vi.fn()} onDelete={vi.fn()}
            />,
        )
        fill("val-1", "On-call", "123456789012345678")
        fireEvent.change(document.querySelector("#contact-webhook")!, { target: { value: "9" } })
        fireEvent.click(screen.getByText("Add Contact", { selector: "button" }))

        await waitFor(() => expect(onAdd).toHaveBeenCalled())
        expect(onAdd.mock.calls[0][0].IDwebhook).toBe(9)
    })

    it("renders exactly one option per webhook — no duplicate ids", async () => {
        render(
            <AlertContactForm
                contacts={[]} webhooks={[webhook(1), webhook(2)]}
                onAdd={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()}
            />,
        )
        const values = [...document.querySelectorAll("#contact-webhook option")]
            .map(o => (o as HTMLOptionElement).value)
        expect(values).toEqual([...new Set(values)])
        expect(values).toEqual(["1", "2"])
    })
})

describe("AlertContactForm without a linkable webhook", () => {
    afterEach(() => { cleanup(); vi.clearAllMocks() })

    it("refuses to submit and explains why", async () => {
        const onAdd = vi.fn()
        render(
            <AlertContactForm
                contacts={[]} webhooks={[]}
                onAdd={onAdd} onUpdate={vi.fn()} onDelete={vi.fn()}
            />,
        )
        fill("val-1", "On-call", "123456789012345678")
        fireEvent.click(screen.getByText("Add Contact", { selector: "button" }))

        await waitFor(() =>
            expect(screen.getByText(/add a validator webhook first/i)).toBeTruthy())
        expect(onAdd).not.toHaveBeenCalled()
    })

    it("submits normally once a webhook exists", async () => {
        const onAdd = vi.fn().mockResolvedValue({ ok: true })
        render(
            <AlertContactForm
                contacts={[]} webhooks={[webhook(4)]}
                onAdd={onAdd} onUpdate={vi.fn()} onDelete={vi.fn()}
            />,
        )
        fill("val-1", "On-call", "123456789012345678")
        fireEvent.click(screen.getByText("Add Contact", { selector: "button" }))

        await waitFor(() => expect(onAdd).toHaveBeenCalled())
        expect(onAdd.mock.calls[0][0].IDwebhook).toBe(4)
    })
})
