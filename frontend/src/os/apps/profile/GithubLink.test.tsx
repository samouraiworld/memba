import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { UserProfile } from "../../../lib/profile"
import type { OsSession } from "../../shell/useOsSession"

const available = vi.hoisted(() => ({ value: true }))
const start = vi.hoisted(() => vi.fn())
const update = vi.hoisted(() => vi.fn())
vi.mock("../../../lib/githubLink", () => ({ githubLinkAvailable: () => available.value, startGithubLink: start }))
vi.mock("../../../lib/profile", () => ({ updateBackendProfile: update }))

import { GithubLink } from "./GithubLink"

const token = { userAddress: "g1owner" }
function session(withToken = true) {
    return { layout: { auth: { token: withToken ? token : null } }, openConnect: vi.fn() } as unknown as OsSession
}
/** `memba` is the backend's verified link; fetchUserProfile shows it over Gnolove's. */
function profile(memba = "", githubLogin = ""): UserProfile {
    const github = memba || (githubLogin ? `https://github.com/${githubLogin}` : "")
    return { githubLogin, membaGithub: memba, socialLinks: { github, twitter: "", website: "" } } as unknown as UserProfile
}

beforeEach(() => {
    available.value = true
    start.mockReset()
    update.mockReset()
})

describe("GithubLink", () => {
    it("starts the link for the signed-in wallet", async () => {
        start.mockResolvedValue(undefined)
        render(<GithubLink address="g1owner" legacy={profile()} session={session()} onChanged={() => {}} />)
        fireEvent.click(screen.getByRole("button", { name: "Link GitHub" }))
        await waitFor(() => expect(start).toHaveBeenCalledWith(token, "g1owner", undefined))
    })

    it("says so when the link cannot start, and lets the owner try again", async () => {
        start.mockRejectedValue(new Error("HTTP 500"))
        render(<GithubLink address="g1owner" legacy={profile()} session={session()} onChanged={() => {}} />)
        fireEvent.click(screen.getByRole("button", { name: "Link GitHub" }))
        expect(await screen.findByRole("alert")).toHaveTextContent("Could not start the GitHub link")
        expect(screen.getByRole("button", { name: "Link GitHub" })).toBeEnabled()
    })

    it("asks a session without a token to connect first", () => {
        const s = session(false)
        render(<GithubLink address="g1owner" legacy={profile()} session={s} onChanged={() => {}} />)
        fireEvent.click(screen.getByRole("button", { name: "Link GitHub" }))
        expect(s.openConnect).toHaveBeenCalled()
        expect(start).not.toHaveBeenCalled()
    })

    it("unlinks a Memba link and re-reads the profile", async () => {
        update.mockResolvedValue(undefined)
        const onChanged = vi.fn()
        render(<GithubLink address="g1owner" legacy={profile("https://github.com/octo")} session={session()} onChanged={onChanged} />)
        expect(screen.getByRole("link", { name: /@octo/ })).toHaveAttribute("href", "https://github.com/octo")
        fireEvent.click(screen.getByRole("button", { name: "Unlink GitHub" }))
        await waitFor(() => expect(onChanged).toHaveBeenCalled())
        expect(update).toHaveBeenCalledWith(token, { github: "" })
    })

    it("offers Unlink for a Memba link even when Gnolove links the same account", () => {
        render(<GithubLink address="g1owner" legacy={profile("https://github.com/octo", "octo")} session={session()} onChanged={() => {}} />)
        expect(screen.getByRole("button", { name: "Unlink GitHub" })).toBeInTheDocument()
        expect(screen.getByText("@octo is linked through Gnolove.")).toBeInTheDocument()
    })

    it("shows a Gnolove link without an action it could not take", () => {
        render(<GithubLink address="g1owner" legacy={profile("", "octo")} session={session()} onChanged={() => {}} />)
        expect(screen.getByText("@octo is linked through Gnolove.")).toBeInTheDocument()
        expect(screen.queryByRole("button")).toBeNull()
    })

    it("shows nothing on a build without the OAuth app", () => {
        available.value = false
        const { container } = render(<GithubLink address="g1owner" legacy={profile()} session={session()} onChanged={() => {}} />)
        expect(container).toBeEmptyDOMElement()
    })
})
