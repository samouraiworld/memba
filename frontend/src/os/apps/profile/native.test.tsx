import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithProviders } from "../../../test/test-utils"
import type { SignRequest } from "../../sign/signer"

const OWNER = "g1manfred47kzduec920z88wfr64ylksmdcedlf5"
const OTHER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const sign = vi.fn<(request: SignRequest) => void>()
const price = vi.fn()
const mocks = vi.hoisted(() => ({ read: vi.fn(), legacy: vi.fn(), publishOn: true }))

vi.mock("../../../lib/config", async (original) => ({ ...(await original<typeof import("../../../lib/config")>()), getUsernameRegistrarPath: () => "gno.land/r/sys/namereg/v0" }))
vi.mock("../../../lib/grc20", async (original) => ({ ...(await original<typeof import("../../../lib/grc20")>()), networkGasPriceFresh: () => price() }))
vi.mock("../../../lib/profile", () => ({ fetchUserProfile: mocks.legacy }))
vi.mock("../../../lib/usernameRegistration", async (original) => ({ ...(await original<typeof import("../../../lib/usernameRegistration")>()), fetchRegisterPrice: vi.fn(async () => 0n) }))
// Stands in for an upload. Like the real one, it hands the pinned URL to the callback it was given when
// the upload started, whatever the editor did since; without a start it uses the current one.
vi.mock("../../../components/profile/AvatarUploader", async () => {
    const { useRef } = await import("react")
    return {
        AvatarUploader: ({ onUrlChange }: { onUrlChange: (url: string) => void }) => {
            const started = useRef<((url: string) => void) | null>(null)
            return <><button type="button" onClick={() => { started.current = onUrlChange }}>Start upload</button><button type="button" onClick={() => (started.current ?? onUrlChange)("https://example.org/avatar.png")}>Finish upload</button></>
        },
    }
})
const signerState = { version: 0 }
vi.mock("../../sign/signerContext", () => ({ useSigner: () => ({ sign, version: signerState.version }) }))
// Shows what the canvas was given, so a test can read the name and the bio a view or a preview would show.
vi.mock("./GithubLink", () => ({ GithubLink: ({ address }: { address: string }) => <div data-testid="github-card">{address}</div> }))
vi.mock("../../profile/ProfileCanvas", () => ({ ProfileCanvas: ({ profile }: { profile: ShownProfile }) => <div data-testid="canvas">{profile.displayName} / {profile.bio.value} / {profile.bio.source} / {profile.location.value} / {profile.location.source}</div> }))
vi.mock("../../profile/profilePublish", async (original) => ({ ...(await original<typeof import("../../profile/profilePublish")>()), get profilePublishEnabled() { return mocks.publishOn } }))
vi.mock("../../profile/profileData", async (original) => ({ ...(await original<typeof import("../../profile/profileData")>()), readProfileOnChain: mocks.read }))

import type { UserProfile } from "../../../lib/profile"
import { defaultProfileDocument, type ProfileChainRead } from "../../profile/profileData"
import type { ShownProfile } from "../../profile/profileModel"
import { REPAIR_LINE } from "../../profile/profilePublish"
import ProfileWindow from "./native"

const chainRead = (over: Partial<ProfileChainRead> = {}, core: Partial<ProfileChainRead["core"]> = {}): ProfileChainRead => ({
    core: { displayName: "Alice", bio: "Hi", avatar: null, homepage: null, location: null, ...core },
    document: defaultProfileDocument(), documentPresent: false, documentUnreadable: false, documentInvalid: false, documentNewer: false, documentOversize: false, missingCore: [], invalidCore: [], ...over,
})
/** What the legacy read returns; both bio sources answered unless a test says otherwise. */
const legacyProfile = (over: Partial<UserProfile> = {}) => ({ username: "", bio: "", githubBio: "", avatarUrl: "", githubAvatar: "", githubLocation: "", title: "", company: "", socialLinks: { website: "", github: "", twitter: "" }, governanceVotes: [], deployedPackages: [], bioSourcesRead: true, ...over }) as unknown as UserProfile
const DRAFT_KEY = `memba_profile_draft:gnoland-1:${OWNER}`

// Twice the fallback price, so a request built on the fallback would show another fee.
const CHAIN_PRICE = { gas: 1000, ugnot: 2 }
const session = { status: "member", address: OWNER, network: { key: "mainnet", label: "gno.land", chainId: "gnoland-1" }, openConnect: vi.fn() } as never
const profileWindow = (section: string | null = null) => <ProfileWindow section={section} session={session} open={vi.fn()} openApp={vi.fn()} close={vi.fn()} toast={vi.fn()} fallback={null} />
const open = () => renderWithProviders(profileWindow())
/** A window a test can re-render, as the shell does when a signature settles. */
function mounted() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const tree = (section: string | null = null) => <QueryClientProvider client={client}>{profileWindow(section)}</QueryClientProvider>
    const view = render(tree())
    return { settle: () => { signerState.version += 1; view.rerender(tree()) }, show: (section: string | null) => view.rerender(tree(section)) }
}
const bioBox = () => screen.getByRole("textbox", { name: "Bio" })

beforeEach(() => {
    sign.mockReset(); price.mockReset(); localStorage.clear(); signerState.version = 0; mocks.publishOn = true
    mocks.read.mockReset().mockImplementation(async () => chainRead())
    mocks.legacy.mockReset().mockRejectedValue(new Error("offline"))
})

describe("Profile window: the fee is quoted from the chain at every review", () => {
    it("opens a publish review on a fresh price, and stops before the sheet when a later read fails", async () => {
        price.mockResolvedValueOnce(CHAIN_PRICE)
        open()
        fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }))
        fireEvent.change(screen.getByRole("textbox", { name: "Bio" }), { target: { value: "Hello Gno" } })
        fireEvent.click(screen.getByRole("button", { name: "Review & publish 1 change" }))
        await waitFor(() => expect(sign).toHaveBeenCalledTimes(1))
        expect(sign.mock.calls[0][0].lines(undefined)).toContainEqual(["Network fee", "0.0336 GNOT"])

        // The earlier price must not be reused: the chain no longer answers.
        price.mockRejectedValueOnce(new Error("offline"))
        fireEvent.click(await screen.findByRole("button", { name: "Review & publish 1 change" }))
        expect(await screen.findByText("The network fee could not be read. Try again in a moment.")).toBeInTheDocument()
        expect(sign).toHaveBeenCalledTimes(1)
    })

    it("does the same for a username registration", async () => {
        price.mockResolvedValueOnce(CHAIN_PRICE)
        open()
        fireEvent.change(await screen.findByRole("textbox", { name: "Username" }), { target: { value: "nym-builder042" } })
        fireEvent.click(screen.getByRole("button", { name: "Review registration" }))
        await waitFor(() => expect(sign).toHaveBeenCalledTimes(1))
        expect(sign.mock.calls[0][0].lines(undefined)).toContainEqual(["Network fee", "0.216 GNOT"])

        price.mockRejectedValueOnce(new Error("offline"))
        fireEvent.click(await screen.findByRole("button", { name: "Review registration" }))
        expect(await screen.findByRole("alert")).toHaveTextContent("The network fee could not be read. Try again in a moment.")
        expect(sign).toHaveBeenCalledTimes(1)
    })

    it("asks for one publish review while the fee is read, with the fields inert and the button still focusable", async () => {
        let answer: (value: typeof CHAIN_PRICE) => void = () => {}
        price.mockReturnValue(new Promise((resolve) => { answer = resolve }))
        open()
        fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }))
        const bio = screen.getByRole("textbox", { name: "Bio" })
        fireEvent.change(bio, { target: { value: "Hello Gno" } })
        fireEvent.click(screen.getByRole("button", { name: "Review & publish 1 change" }))
        const waiting = await screen.findByRole("button", { name: "Checking fee…" })
        expect(waiting).toHaveAttribute("aria-disabled", "true")
        expect(waiting).toBeEnabled()
        expect(waiting.closest("[inert]")).toBeNull()
        expect(bio.closest("[inert]")).not.toBeNull()
        fireEvent.click(waiting)
        fireEvent.click(waiting)
        expect(price).toHaveBeenCalledTimes(1)
        await act(async () => { answer(CHAIN_PRICE) })
        expect(sign).toHaveBeenCalledTimes(1)
        expect(screen.getByRole("textbox", { name: "Bio" }).closest("[inert]")).toBeNull()
    })

    it("opens no publish review for an editor that closed while the fee was read", async () => {
        let answer: (value: typeof CHAIN_PRICE) => void = () => {}
        price.mockReturnValue(new Promise((resolve) => { answer = resolve }))
        open()
        fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }))
        fireEvent.change(screen.getByRole("textbox", { name: "Bio" }), { target: { value: "Hello Gno" } })
        fireEvent.click(screen.getByRole("button", { name: "Review & publish 1 change" }))
        // "View published" is outside the inert fields: it closes the editor mid-read.
        fireEvent.click(screen.getByRole("button", { name: "View published" }))
        await act(async () => { answer(CHAIN_PRICE) })
        expect(sign).not.toHaveBeenCalled()
    })

    it("locks the username while its registration fee is read, and asks for one review", async () => {
        let answer: (value: typeof CHAIN_PRICE) => void = () => {}
        price.mockReturnValue(new Promise((resolve) => { answer = resolve }))
        open()
        const name = await screen.findByRole("textbox", { name: "Username" })
        fireEvent.change(name, { target: { value: "nym-builder042" } })
        fireEvent.click(screen.getByRole("button", { name: "Review registration" }))
        const waiting = await screen.findByRole("button", { name: "Checking price…" })
        expect(waiting).toHaveAttribute("aria-disabled", "true")
        expect(waiting).toBeEnabled()
        expect(name).toBeDisabled()
        fireEvent.click(waiting)
        await act(async () => { answer(CHAIN_PRICE) })
        await waitFor(() => expect(sign).toHaveBeenCalledTimes(1))
        expect(price).toHaveBeenCalledTimes(1)
        expect(sign.mock.calls[0][0].summary).toBe("Register @nym-builder042")
    })

    it("opens no registration review for a panel that closed while the fee was read", async () => {
        let answer: (value: typeof CHAIN_PRICE) => void = () => {}
        price.mockReturnValue(new Promise((resolve) => { answer = resolve }))
        open()
        fireEvent.change(await screen.findByRole("textbox", { name: "Username" }), { target: { value: "nym-builder042" } })
        fireEvent.click(screen.getByRole("button", { name: "Review registration" }))
        // Opening the editor replaces the published view and its registration panel mid-read.
        fireEvent.click(screen.getByRole("button", { name: "Edit profile" }))
        await act(async () => { answer(CHAIN_PRICE) })
        await act(async () => {})
        expect(sign).not.toHaveBeenCalled()
    })

    it("opens no review when an upload changed the draft while the fee was read", async () => {
        let answer: (value: typeof CHAIN_PRICE) => void = () => {}
        price.mockReturnValueOnce(new Promise((resolve) => { answer = resolve }))
        open()
        fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }))
        fireEvent.change(screen.getByRole("textbox", { name: "Bio" }), { target: { value: "Hello Gno" } })
        fireEvent.click(screen.getByRole("button", { name: "Review & publish 1 change" }))
        fireEvent.click(screen.getByRole("button", { name: "Finish upload" }))
        await act(async () => { answer(CHAIN_PRICE) })
        expect(sign).not.toHaveBeenCalled()
        expect(screen.getByText("Your draft changed while the fee was read. Check it, then publish again.")).toBeInTheDocument()
        // The next click reviews the draft as it now is: both changes.
        price.mockResolvedValueOnce(CHAIN_PRICE)
        fireEvent.click(screen.getByRole("button", { name: "Review & publish 2 changes" }))
        await waitFor(() => expect(sign).toHaveBeenCalledTimes(1))
        expect(sign.mock.calls[0][0].lines(undefined)).toEqual(expect.arrayContaining([["Bio", "Hello Gno"], ["Avatar", "https://example.org/avatar.png"]]))
    })

    it("keeps an edit typed while an upload ran, when the upload lands on the callback it started with", async () => {
        price.mockResolvedValueOnce(CHAIN_PRICE)
        open()
        fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }))
        fireEvent.click(screen.getByRole("button", { name: "Start upload" }))
        fireEvent.change(bioBox(), { target: { value: "Typed during the upload" } })
        fireEvent.click(screen.getByRole("button", { name: "Finish upload" }))
        expect(bioBox()).toHaveValue("Typed during the upload")
        fireEvent.click(screen.getByRole("button", { name: "Review & publish 2 changes" }))
        await waitFor(() => expect(sign).toHaveBeenCalledTimes(1))
        expect(sign.mock.calls[0][0].lines(undefined)).toEqual(expect.arrayContaining([["Bio", "Typed during the upload"], ["Avatar", "https://example.org/avatar.png"]]))
    })
})

describe("Profile window: the editor and the chain read it is built on", () => {
    it("keeps the editor, its draft and the focus when a signature settles without a change", async () => {
        const { settle } = mounted()
        fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }))
        const bio = bioBox()
        fireEvent.change(bio, { target: { value: "Hello Gno" } })
        const publish = screen.getByRole("button", { name: "Review & publish 1 change" })
        publish.focus()
        // A cancelled review settles: the signer's version moves and the profile is read again.
        settle()
        await act(async () => {})
        expect(bioBox()).toBe(bio)
        expect(bio).toHaveValue("Hello Gno")
        expect(publish).toHaveFocus()
    })

    it("offers no change back to an older value when the editor opens before a re-read lands", async () => {
        const { settle } = mounted()
        await screen.findByRole("button", { name: "Edit profile" })
        await waitFor(() => expect(screen.queryByText("Reading profile from Gno…")).toBeNull())
        let answer: (value: ProfileChainRead) => void = () => {}
        mocks.read.mockReturnValueOnce(new Promise((resolve) => { answer = resolve }))
        settle()
        // The published view waits for the new read; the editor opens on the last one.
        expect(screen.getByText("Reading profile from Gno…")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Edit profile" }))
        expect(bioBox()).toHaveValue("Hi")
        await act(async () => { answer(chainRead({}, { bio: "Published meanwhile" })) })
        expect(bioBox()).toHaveValue("Published meanwhile")
        expect(screen.getByRole("button", { name: "Review & publish 0 changes" })).toBeDisabled()
    })

    it("moves untouched fields onto a newer read and keeps the one the owner edited", async () => {
        price.mockResolvedValueOnce(CHAIN_PRICE)
        const { settle } = mounted()
        fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }))
        fireEvent.change(screen.getByRole("textbox", { name: "Location" }), { target: { value: "Paris" } })
        mocks.read.mockResolvedValueOnce(chainRead({}, { bio: "Published meanwhile" }))
        settle()
        await waitFor(() => expect(bioBox()).toHaveValue("Published meanwhile"))
        expect(screen.getByRole("textbox", { name: "Location" })).toHaveValue("Paris")
        // The saved local draft follows too, with the read it now stands on.
        const saved = JSON.parse(localStorage.getItem(DRAFT_KEY)!)
        expect(saved.draft.core).toMatchObject({ bio: "Published meanwhile", location: "Paris" })
        expect(saved.on.core).toMatchObject({ bio: "Published meanwhile", location: "" })
        fireEvent.click(screen.getByRole("button", { name: "Review & publish 1 change" }))
        await waitFor(() => expect(sign).toHaveBeenCalledTimes(1))
        const lines = sign.mock.calls[0][0].lines(undefined)
        expect(lines).toContainEqual(["Location", "Paris"])
        expect(lines.map(([label]: [string, string]) => label)).not.toContain("Bio")
    })

    it("undoes to the chain's value, not to an older one, when the chain changed the field the owner edited", async () => {
        const { settle } = mounted()
        fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }))
        fireEvent.change(bioBox(), { target: { value: "Hello Gno" } })
        mocks.read.mockImplementation(async () => chainRead({}, { bio: "Chain new" }))
        settle()
        // The edit stays the owner's; nothing else in the draft moved.
        await screen.findByRole("button", { name: "Review & publish 1 change" })
        await waitFor(() => expect(JSON.parse(localStorage.getItem(DRAFT_KEY)!).on.core.bio).toBe("Chain new"))
        expect(bioBox()).toHaveValue("Hello Gno")
        fireEvent.click(screen.getByRole("button", { name: "Undo" }))
        expect(bioBox()).toHaveValue("Chain new")
        expect(screen.getByRole("button", { name: "Review & publish 0 changes" })).toBeDisabled()
    })

    it("restores a draft saved on an older read onto the current one: only what the owner typed is a change", async () => {
        price.mockResolvedValueOnce(CHAIN_PRICE)
        const { settle } = mounted()
        await screen.findByRole("button", { name: "Edit profile" })
        await waitFor(() => expect(screen.queryByText("Reading profile from Gno…")).toBeNull())
        let answer: (value: ProfileChainRead) => void = () => {}
        mocks.read.mockReturnValueOnce(new Promise((resolve) => { answer = resolve }))
        settle()
        // Typed while the editor stands on the previous read, then closed.
        fireEvent.click(screen.getByRole("button", { name: "Edit profile" }))
        fireEvent.change(screen.getByRole("textbox", { name: "Location" }), { target: { value: "Paris" } })
        fireEvent.click(screen.getByRole("button", { name: "View published" }))
        mocks.read.mockImplementation(async () => chainRead({}, { bio: "Published meanwhile" }))
        await act(async () => { answer(chainRead({}, { bio: "Published meanwhile" })) })
        fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }))
        expect(bioBox()).toHaveValue("Published meanwhile")
        expect(screen.getByRole("textbox", { name: "Location" })).toHaveValue("Paris")
        fireEvent.click(screen.getByRole("button", { name: "Review & publish 1 change" }))
        await waitFor(() => expect(sign).toHaveBeenCalledTimes(1))
        expect(sign.mock.calls[0][0].prepare(undefined).msgs.map((msg) => msg.value.args)).toEqual([["Location", "Paris"]])
    })

    it("does not restore a draft saved without the read it was made on", async () => {
        // The earlier format: full values only. Its Bio would come back as a change over a chain that moved on.
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ core: { displayName: "Alice", bio: "Older bio", avatar: "", homepage: "", location: "" }, document: defaultProfileDocument() }))
        open()
        fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }))
        expect(bioBox()).toHaveValue("Hi")
        expect(screen.getByRole("button", { name: "Review & publish 0 changes" })).toBeDisabled()
    })

    it("never supplies a replacement its owner did not type for a value that became unshowable", async () => {
        // Saved while Location was "Lyon" on chain and untouched; the chain now holds an over-limit Location.
        const on = { core: { displayName: "Alice", bio: "Hi", avatar: "", homepage: "", location: "Lyon" }, document: defaultProfileDocument() }
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ draft: { ...on, core: { ...on.core, bio: "Hello Gno" } }, on }))
        mocks.read.mockImplementation(async () => chainRead({ invalidCore: ["location"] }))
        price.mockResolvedValueOnce(CHAIN_PRICE)
        open()
        fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }))
        expect(screen.getByRole("textbox", { name: "Location" })).toHaveValue("")
        fireEvent.click(screen.getByRole("button", { name: "Review & publish 1 change" }))
        await waitFor(() => expect(sign).toHaveBeenCalledTimes(1))
        expect(sign.mock.calls[0][0].prepare(undefined).msgs.map((msg) => msg.value.args)).toEqual([["Bio", "Hello Gno"]])
    })

    it("keeps the editor and its draft when the re-read fails", async () => {
        const { settle } = mounted()
        fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }))
        fireEvent.change(bioBox(), { target: { value: "Hello Gno" } })
        mocks.read.mockRejectedValueOnce(new Error("offline"))
        settle()
        await act(async () => {})
        expect(bioBox()).toHaveValue("Hello Gno")
        expect(screen.queryByText("The profile could not be loaded.")).toBeNull()
        // The published view does not pass the last read off as current.
        fireEvent.click(screen.getByRole("button", { name: "View published" }))
        expect(await screen.findByText("The profile could not be loaded.")).toBeInTheDocument()
    })

    it("never shows one address's profile while another's is being read", async () => {
        const { show } = mounted()
        expect(await screen.findByTestId("canvas")).toHaveTextContent("Alice / Hi")
        mocks.read.mockReturnValueOnce(new Promise(() => {}))
        show(OTHER)
        expect(screen.getByText("Reading profile from Gno…")).toBeInTheDocument()
        expect(screen.queryByTestId("canvas")).toBeNull()
    })
})

describe("Profile window: templates and section order", () => {
    const listed = (tab: string) => within(screen.getByRole("list", { name: `${tab} tab sections` })).getAllByRole("listitem").map((item) => item.firstChild!.textContent)

    it("moves a section only among the sections of its own tab", async () => {
        open()
        fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }))
        expect(listed("Overview")).toEqual(["About · Overview tab", "Links · Overview tab", "Public assets · Overview tab", "Credentials · Overview tab", "Reviews · Overview tab"])
        fireEvent.click(screen.getByRole("button", { name: "Move Links down" }))
        // Its neighbour in the Overview tab, not the DAOs section that sits between them in the stored order.
        expect(listed("Overview")).toEqual(["About · Overview tab", "Public assets · Overview tab", "Links · Overview tab", "Credentials · Overview tab", "Reviews · Overview tab"])
        expect(listed("DAOs")).toEqual(["Memberships and roles · DAOs tab", "Governance votes · DAOs tab"])
        expect(screen.getByRole("button", { name: "Move Reviews down" })).toBeDisabled()
    })

    it("changes only the template when one is picked: the section order and what is hidden stay", async () => {
        open()
        fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }))
        const showLinks = () => within(screen.getByRole("list", { name: "Overview tab sections" })).getAllByRole("checkbox")[1]
        fireEvent.click(showLinks())
        fireEvent.click(screen.getByRole("button", { name: "Move Reviews up" }))
        const order = listed("Overview")
        expect(order.at(-2)).toBe("Reviews · Overview tab")
        fireEvent.click(screen.getByRole("button", { name: "builder" }))
        expect(screen.getByRole("button", { name: "builder" })).toHaveAttribute("aria-pressed", "true")
        expect(screen.getByText("Two columns on wide windows. Contributions and Home follow the overview.")).toBeInTheDocument()
        expect(listed("Overview")).toEqual(order)
        expect(showLinks()).not.toBeChecked()
    })
})

describe("Profile window: stored values Memba cannot show", () => {
    const broken = () => chainRead({ invalidCore: ["location"], documentInvalid: true })

    it("names them, leaves them alone beside another edit, and marks a replacement the owner entered", async () => {
        price.mockResolvedValue(CHAIN_PRICE)
        mocks.read.mockImplementation(async () => broken())
        open()
        fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }))
        expect(screen.getByText(/Memba cannot show what is stored on chain for Location, your saved layout/)).toHaveTextContent("What you leave empty is not touched.")
        // Nothing is forced: an untouched editor has nothing to publish.
        expect(screen.getByRole("button", { name: "Review & publish 0 changes" })).toBeDisabled()
        fireEvent.change(bioBox(), { target: { value: "Hello Gno" } })
        fireEvent.click(screen.getByRole("button", { name: "Review & publish 1 change" }))
        await waitFor(() => expect(sign).toHaveBeenCalledTimes(1))
        expect(sign.mock.calls[0][0].prepare(undefined).msgs.map((msg) => msg.value.args[0])).toEqual(["Bio"])

        fireEvent.change(screen.getByRole("textbox", { name: "Location" }), { target: { value: "Paris" } })
        fireEvent.click(await screen.findByRole("button", { name: "Review & publish 2 changes" }))
        await waitFor(() => expect(sign).toHaveBeenCalledTimes(2))
        const request = sign.mock.calls[1][0]
        expect(request.lines(undefined)).toEqual(expect.arrayContaining([["Bio", "Hello Gno"], [`Location (${REPAIR_LINE})`, "Paris"]]))
        expect(request.warns?.join(" ")).toContain("Location: the value stored on chain is too long for Memba")
        expect(request.acks).toContain("I understand this replaces what is stored on chain for Location.")
    })

    it("previews an untouched one as the published view shows it: the earlier detail, not an empty field", async () => {
        mocks.legacy.mockResolvedValue(legacyProfile({ githubLocation: "Lyon" }))
        mocks.read.mockImplementation(async () => broken())
        open()
        await waitFor(() => expect(screen.getByTestId("canvas")).toHaveTextContent("Lyon / Gnolove"))
        const published = screen.getByTestId("canvas").textContent
        fireEvent.click(screen.getByRole("button", { name: "Edit profile" }))
        expect(screen.getByTestId("canvas").textContent).toBe(published)
    })

    it("says nothing about replacing them while publishing is off", async () => {
        mocks.publishOn = false
        mocks.read.mockImplementation(async () => broken())
        open()
        fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }))
        expect(bioBox()).toBeInTheDocument()
        expect(screen.queryByText(/Memba cannot show what is stored on chain/)).toBeNull()
    })

    it("does not let this version change a layout saved by a newer one, and still publishes the other fields", async () => {
        price.mockResolvedValueOnce(CHAIN_PRICE)
        mocks.read.mockImplementation(async () => chainRead({ documentNewer: true }))
        open()
        fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }))
        expect(screen.getByText(/Your layout was saved by a newer version of Memba/).textContent)
            .toBe("Your layout was saved by a newer version of Memba. This version shows the default layout and cannot change yours: reload Memba to edit it. Your name, bio and other fields can still be published.")
        for (const name of ["Title", "Company", "Cover image URL"]) expect(screen.getByRole("textbox", { name })).toBeDisabled()
        expect(screen.getByRole("button", { name: "builder" })).toBeDisabled()
        expect(screen.getByRole("button", { name: "Add link" })).toBeDisabled()
        fireEvent.change(bioBox(), { target: { value: "Hello Gno" } })
        fireEvent.click(screen.getByRole("button", { name: "Review & publish 1 change" }))
        await waitFor(() => expect(sign).toHaveBeenCalledTimes(1))
        expect(sign.mock.calls[0][0].prepare(undefined).msgs.map((msg) => msg.value.args[0])).toEqual(["Bio"])
    })

    it("locks a layout too large to read the same way, drops a restored layout draft, and promises no publishing while it is off", async () => {
        mocks.publishOn = false
        // A draft with a layout change and a link, saved before the stored layout became unreadable.
        const on = { core: { displayName: "Alice", bio: "Hi", avatar: "", homepage: "", location: "" }, document: defaultProfileDocument() }
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ draft: { ...on, document: { ...on.document, title: "Designer", links: [{ label: "Work", url: "https://example.org/" }] } }, on }))
        mocks.read.mockImplementation(async () => chainRead({ documentOversize: true }))
        open()
        fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }))
        // Reloading does not help here, and with publishing off nothing is promised: the whole notice is this sentence.
        expect(screen.getByText(/Your saved layout is too large/).textContent)
            .toBe("Your saved layout is too large for this version of Memba to read. It shows the default layout and cannot change yours.")
        // The layout part of the draft is gone: nothing to undo by hand, no link row left enabled.
        expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("")
        expect(screen.queryByRole("textbox", { name: "Link 1 label" })).toBeNull()
        expect(screen.queryByRole("alert")).toBeNull()
    })
})

describe("Profile window: an empty Bio", () => {
    const legacy = legacyProfile({ bio: "Backend bio" })
    const preview = () => screen.getByTestId("canvas")

    it("does not offer to clear a published Bio while an earlier bio would show in its place", async () => {
        mocks.legacy.mockResolvedValue(legacy)
        open()
        fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }))
        await waitFor(() => expect(screen.getByRole("button", { name: "Import available Memba details" })).toBeInTheDocument())
        fireEvent.change(bioBox(), { target: { value: "" } })
        expect(screen.getByText(/An empty bio would show your earlier Memba or GitHub bio in its place, so clearing it is not published/)).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Review & publish 0 changes" })).toBeDisabled()
        // The preview is what a publish would show: the Bio as it is on chain.
        expect(preview()).toHaveTextContent("Alice / Hi / Gno profile")
    })

    it("holds the clear while it is not known whether an earlier bio exists", async () => {
        // The legacy read failed (the default here), or answered without both of its bio sources.
        for (const unknown of [() => mocks.legacy.mockRejectedValue(new Error("offline")), () => mocks.legacy.mockResolvedValue(legacyProfile({ bioSourcesRead: false }))]) {
            unknown()
            const view = open()
            fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }))
            await act(async () => {})
            fireEvent.change(bioBox(), { target: { value: "" } })
            expect(screen.getByText(/Clearing the bio is on hold: your earlier Memba and GitHub details have not been read/)).toBeInTheDocument()
            expect(screen.getByRole("button", { name: "Review & publish 0 changes" })).toBeDisabled()
            expect(preview()).toHaveTextContent("Alice / Hi / Gno profile")
            view.unmount()
            localStorage.clear()
        }
    })

    it("publishes the clear when nothing would take the Bio's place", async () => {
        price.mockResolvedValueOnce(CHAIN_PRICE)
        mocks.legacy.mockResolvedValue(legacyProfile())
        open()
        await screen.findByRole("button", { name: "Edit profile" })
        await act(async () => {})
        fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }))
        fireEvent.change(bioBox(), { target: { value: "" } })
        expect(screen.queryByText(/An empty bio would show/)).toBeNull()
        expect(preview()).toHaveTextContent("Alice / / None")
        fireEvent.click(screen.getByRole("button", { name: "Review & publish 1 change" }))
        await waitFor(() => expect(sign).toHaveBeenCalledTimes(1))
        expect(sign.mock.calls[0][0].lines(undefined)).toContainEqual(["Bio", "(clear)"])
    })

    it("previews the earlier bio over the empty Bio that wallet activation wrote", async () => {
        mocks.legacy.mockResolvedValue(legacy)
        mocks.read.mockImplementation(async () => chainRead({}, { bio: "" }))
        open()
        fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }))
        await waitFor(() => expect(preview()).toHaveTextContent("Alice / Backend bio / Memba legacy"))
        expect(screen.getByRole("button", { name: "Review & publish 0 changes" })).toBeDisabled()
    })
})

describe("Profile window: the GitHub card", () => {
    const OTHER = "g1nn54k5fmly8agexe3ll4t6clqmcefsn7nr9ee3"
    it("is the owner's, on their own profile only", async () => {
        mocks.legacy.mockResolvedValue(legacyProfile())
        const own = mounted()
        expect(await screen.findByTestId("github-card")).toHaveTextContent(OWNER)
        own.show(OTHER) // a signed-in visitor on someone else's profile
        expect(await screen.findByTestId("canvas")).toBeInTheDocument()
        expect(screen.queryByTestId("github-card")).toBeNull()
    })
})
