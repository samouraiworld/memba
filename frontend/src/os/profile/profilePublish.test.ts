import { describe, expect, it, vi } from "vitest"
vi.mock("./profileData", async (original) => ({ ...(await original<typeof import("./profileData")>()), readProfileOnChain: vi.fn() }))
vi.mock("../../lib/grc20", async (original) => ({ ...(await original<typeof import("../../lib/grc20")>()), freshFeeForGasWanted: vi.fn(), doContractBroadcast: vi.fn() }))
import { doContractBroadcast, FALLBACK_GAS_PRICE, freshFeeForGasWanted } from "../../lib/grc20"
import { defaultProfileDocument, readProfileOnChain, type ProfileChainRead } from "./profileData"
import type { UserProfile } from "../../lib/profile"
import { canPublishProfileDocument, draftFromChain, importLegacyProfile, profileChanges, profileMessages, profilePublishRequest, rebaseDraft, REPAIR_LINE, unpublishedChanges } from "./profilePublish"

const ADDRESS = "g1manfred47kzduec920z88wfr64ylksmdcedlf5"
const base: ProfileChainRead = {
    core: { displayName: "Alice", bio: "Hi", avatar: null, homepage: null, location: null },
    document: defaultProfileDocument(), documentPresent: false, documentUnreadable: false, documentInvalid: false, documentNewer: false, documentOversize: false, missingCore: [], invalidCore: [],
}
const sheetText = (request: ReturnType<typeof profilePublishRequest>) => JSON.stringify([request.lines(undefined), request.warns, request.acks])

describe("profile publication", () => {
    it("runs on the network whose realm stores layouts, so no layout test below is skipped", () => {
        expect(canPublishProfileDocument).toBe(true)
    })

    it("builds calls only for edited fields, owned by the wallet", () => {
        const draft = draftFromChain(base)
        draft.core.bio = "Hello Gno"
        const changes = profileChanges(base, draft)
        expect(changes).toEqual([{ field: "Bio", before: "Hi", after: "Hello Gno", created: false, repair: false }])
        expect(profileMessages(ADDRESS, changes)).toEqual([{
            type: "vm/MsgCall",
            value: { caller: ADDRESS, send: "", pkg_path: expect.any(String), func: "SetStringField", args: ["Bio", "Hello Gno"], max_deposit: "20000ugnot" },
        }])
    })

    it("caps the deposit of a field written for the first time at twice its storage", () => {
        const draft = draftFromChain(base)
        draft.core.location = "Paris"
        const [msg] = profileMessages(ADDRESS, profileChanges(base, draft))
        expect(msg.value).toMatchObject({ args: ["Location", "Paris"], max_deposit: "450000ugnot" })
    })

    it("rejects unsafe URLs and oversize values before a review opens", () => {
        const draft = draftFromChain(base)
        draft.core.homepage = "javascript:alert(1)"
        expect(() => profileChanges(base, draft)).toThrow("homepage must be")
        draft.core.homepage = ""
        draft.core.bio = "x".repeat(501)
        expect(() => profileChanges(base, draft)).toThrow("bio is too long")
    })

    it("publishes title, company, links and layout in the versioned public field on mainnet", () => {
        const draft = draftFromChain(base)
        draft.document.title = "Designer"
        draft.document.company = "Cooperative"
        draft.document.links = [{ label: "Work", url: "https://example.org/" }]
        const changes = profileChanges(base, draft)
        expect(changes).toHaveLength(1)
        expect(changes[0].field).toBe("memba.profile.v1")
        expect(JSON.parse(changes[0].after)).toMatchObject({
            version: 1, title: "Designer", company: "Cooperative",
            links: [{ label: "Work", url: "https://example.org/" }],
        })
        expect(profileMessages(ADDRESS, changes)[0].value.args).toEqual(["memba.profile.v1", changes[0].after])
    })

    it("reads the published profile and the network price at the same time", async () => {
        const draft = draftFromChain(base)
        draft.core.bio = "New bio"
        const request = profilePublishRequest(ADDRESS, base, draft, FALLBACK_GAS_PRICE, vi.fn())
        let profileRead!: () => void
        vi.mocked(readProfileOnChain).mockImplementationOnce(() => new Promise((resolve) => { profileRead = () => resolve(base) }))
        vi.mocked(freshFeeForGasWanted).mockReset().mockResolvedValue(1)
        const checking = request.recheck!(undefined)
        await vi.waitFor(() => expect(profileRead).toBeTypeOf("function"))
        // The profile hasn't answered, and the price is already asked.
        expect(freshFeeForGasWanted).toHaveBeenCalled()
        profileRead()
        await expect(checking).resolves.toBeUndefined()
    })

    it("stops if the published field changed since editing", async () => {
        const draft = draftFromChain(base)
        draft.core.bio = "New bio"
        const request = profilePublishRequest(ADDRESS, base, draft, FALLBACK_GAS_PRICE, vi.fn())
        vi.mocked(readProfileOnChain).mockResolvedValueOnce({ ...base, core: { ...base.core, bio: "Other edit" } })
        await expect(request.recheck?.(undefined)).rejects.toThrow("changed")
        vi.mocked(readProfileOnChain).mockResolvedValueOnce({ ...base, core: { ...base.core, bio: "New bio" } })
        await expect(request.verify?.(undefined, "hash", null)).resolves.toBe(true)
        expect(request.prepare(undefined).msgs).toHaveLength(1)
        expect(request.acks).toHaveLength(1)
        expect(request.lines(undefined)).toContainEqual(["Bio", "New bio"])
    })

    it("states the deposit and fee, and sends exactly that gas limit and fee", async () => {
        const draft = draftFromChain(base)
        draft.core.bio = "New bio"
        draft.core.location = "Paris"
        const request = profilePublishRequest(ADDRESS, base, draft, FALLBACK_GAS_PRICE, vi.fn())
        expect(request.lines(undefined)).toContainEqual(["Storage deposit", "≈ 0.2274 GNOT (cap 0.47 GNOT)"])
        expect(request.lines(undefined)).toContainEqual(["Network fee", "0.0192 GNOT"])
        expect(request.note).toContain("stays locked for good")
        vi.mocked(doContractBroadcast).mockResolvedValueOnce({ hash: "hash" })
        const beforeSign = vi.fn()
        await request.send(undefined, beforeSign)
        expect(doContractBroadcast).toHaveBeenCalledWith(request.prepare(undefined).msgs, "Memba profile", { gasWanted: 16_000_000, gasFee: 19_200, beforeSign })
    })

    it("stops before the wallet when the reviewed fee no longer covers the network price", async () => {
        const draft = draftFromChain(base)
        draft.core.bio = "New bio"
        const request = profilePublishRequest(ADDRESS, base, draft, FALLBACK_GAS_PRICE, vi.fn())
        vi.mocked(readProfileOnChain).mockResolvedValue(base)
        vi.mocked(freshFeeForGasWanted).mockImplementationOnce(async (gas) => Math.ceil(gas * 1.2 * 2 / 1000))
        await expect(request.recheck?.(undefined)).rejects.toThrow("fee increased")
        vi.mocked(freshFeeForGasWanted).mockImplementationOnce(async (gas) => Math.ceil(gas * 1.2 / 1000))
        await expect(request.recheck?.(undefined)).resolves.toBeUndefined()
    })

    it("leaves a field stored over the limit alone until its owner enters a replacement", async () => {
        const broken: ProfileChainRead = { ...base, core: { ...base.core, bio: null, location: null }, invalidCore: ["bio", "location"] }
        const draft = draftFromChain(broken)
        // Nothing is forced, alone or beside another edit.
        expect(profileChanges(broken, draft)).toEqual([])
        draft.core.displayName = "Alice Gno"
        expect(profileChanges(broken, draft).map((change) => change.field)).toEqual(["DisplayName"])
        draft.core.bio = "A shorter bio"
        expect(profileChanges(broken, draft)).toEqual([
            { field: "DisplayName", before: "Alice", after: "Alice Gno", created: false, repair: false },
            { field: "Bio", before: "", after: "A shorter bio", created: false, repair: true },
        ])
        const request = profilePublishRequest(ADDRESS, broken, draft, FALLBACK_GAS_PRICE, vi.fn())
        vi.mocked(freshFeeForGasWanted).mockImplementation(async (gas) => Math.ceil(gas * 1.2 / 1000))
        vi.mocked(readProfileOnChain).mockResolvedValueOnce(broken)
        await expect(request.recheck?.(undefined)).resolves.toBeUndefined()
        // Someone replaced it meanwhile: the draft was built on a state that is gone.
        vi.mocked(readProfileOnChain).mockResolvedValueOnce({ ...base, core: { ...base.core, bio: "" } })
        await expect(request.recheck?.(undefined)).rejects.toThrow("changed")
        // Still over the limit after sending: not confirmed yet.
        vi.mocked(readProfileOnChain).mockResolvedValueOnce({ ...broken, core: { ...broken.core, displayName: "Alice Gno" } })
        await expect(request.verify?.(undefined, "hash", null)).resolves.toBe(false)
        vi.mocked(readProfileOnChain).mockResolvedValueOnce({ ...base, core: { ...base.core, displayName: "Alice Gno", bio: "A shorter bio" }, invalidCore: ["location"] })
        await expect(request.verify?.(undefined, "hash", null)).resolves.toBe(true)
    })

    it("marks a replacement in the sheet: its line, a warning, an acknowledgement and a deposit ceiling", () => {
        const broken: ProfileChainRead = { ...base, core: { ...base.core, bio: null }, invalidCore: ["bio"] }
        const draft = draftFromChain(broken)
        draft.core.bio = "A shorter bio"
        draft.core.location = "Paris"
        const request = profilePublishRequest(ADDRESS, broken, draft, FALLBACK_GAS_PRICE, vi.fn())
        expect(request.lines(undefined)).toEqual(expect.arrayContaining([[`Bio (${REPAIR_LINE})`, "A shorter bio"], ["Location", "Paris"]]))
        expect(request.lines(undefined).find(([label]) => label === "Storage deposit")?.[1]).toMatch(/^at most /)
        expect(request.warns).toHaveLength(2)
        expect(request.warns?.[1]).toBe("Bio: the value stored on chain is too long for Memba, or not a layout it can read, so Memba does not show it. Publishing replaces it for every app that reads this profile.")
        expect(request.acks).toEqual(["I understand these changes are public and require a wallet transaction.", "I understand this replaces what is stored on chain for Bio."])
        // An ordinary edit of the same fields says none of it.
        const ordinary = draftFromChain(base)
        ordinary.core.bio = "A shorter bio"
        ordinary.core.location = "Paris"
        const plain = profilePublishRequest(ADDRESS, base, ordinary, FALLBACK_GAS_PRICE, vi.fn())
        expect(sheetText(plain)).not.toMatch(/replaces|cannot show|at most/)
        expect(plain.warns).toHaveLength(1)
        expect(plain.acks).toHaveLength(1)
    })

    it("replaces a stored layout Memba cannot read only when its owner changes the layout", async () => {
        const broken: ProfileChainRead = { ...base, documentInvalid: true }
        const draft = draftFromChain(broken)
        draft.core.bio = "Only the bio"
        expect(profileChanges(broken, draft).map((change) => change.field)).toEqual(["Bio"])
        draft.document.title = "Designer"
        const changes = profileChanges(broken, draft)
        expect(changes[1]).toMatchObject({ field: "memba.profile.v1", before: "", created: false, repair: true })
        const request = profilePublishRequest(ADDRESS, broken, draft, FALLBACK_GAS_PRICE, vi.fn())
        expect(request.lines(undefined).map(([label]) => label)).toContain(`memba.profile.v1 (${REPAIR_LINE})`)
        vi.mocked(freshFeeForGasWanted).mockImplementation(async (gas) => Math.ceil(gas * 1.2 / 1000))
        vi.mocked(readProfileOnChain).mockResolvedValueOnce(broken)
        await expect(request.recheck?.(undefined)).resolves.toBeUndefined()
        expect(unpublishedChanges(broken, [changes[1]])).toHaveLength(1)
        expect(unpublishedChanges({ ...base, documentPresent: true, document: draft.document }, [changes[1]])).toHaveLength(0)
    })

    it("never writes over a layout saved under a later version, or one too large to read, at review or at the recheck", async () => {
        // Reloading is the way out only for a layout a newer version saved: the whole sentence is pinned for each case.
        const cases: [ProfileChainRead, string][] = [
            [{ ...base, documentNewer: true }, "Your layout was saved by a newer version of Memba, so this version cannot change it. Reload Memba to edit your layout."],
            [{ ...base, documentOversize: true }, "Your saved layout is too large for this version of Memba to read, so it cannot change it."],
        ]
        for (const [locked, message] of cases) {
            const draft = draftFromChain(locked)
            draft.core.bio = "Only the bio"
            expect(profileChanges(locked, draft).map((change) => change.field)).toEqual(["Bio"])
            draft.document.title = "Designer"
            expect(() => profileChanges(locked, draft)).toThrow(new Error(message))
            // A layout change reviewed on an older read: such a layout has been saved since.
            const stale = draftFromChain(base)
            stale.document.title = "Designer"
            const request = profilePublishRequest(ADDRESS, base, stale, FALLBACK_GAS_PRICE, vi.fn())
            vi.mocked(freshFeeForGasWanted).mockImplementation(async (gas) => Math.ceil(gas * 1.2 / 1000))
            vi.mocked(readProfileOnChain).mockResolvedValueOnce(locked)
            await expect(request.recheck?.(undefined)).rejects.toThrow("changed")
        }
    })

    it("confirms nothing from a read that missed a field", async () => {
        const draft = draftFromChain(base)
        draft.core.bio = ""
        const request = profilePublishRequest(ADDRESS, base, draft, FALLBACK_GAS_PRICE, vi.fn())
        // Bio did not answer: it reads as empty, which is also what the change writes.
        vi.mocked(readProfileOnChain).mockResolvedValueOnce({ ...base, core: { ...base.core, bio: null }, missingCore: ["bio"] })
        await expect(request.verify?.(undefined, "hash", null)).resolves.toBe(false)
        vi.mocked(readProfileOnChain).mockResolvedValueOnce({ ...base, core: { ...base.core, bio: "" }, documentUnreadable: true })
        await expect(request.verify?.(undefined, "hash", null)).resolves.toBe(false)
        vi.mocked(readProfileOnChain).mockResolvedValueOnce({ ...base, core: { ...base.core, bio: "" } })
        await expect(request.verify?.(undefined, "hash", null)).resolves.toBe(true)
    })

    it("does not publish a Bio clear while an earlier bio would show in its place", () => {
        const draft = draftFromChain(base)
        draft.core.bio = ""
        draft.core.location = "Paris"
        expect(profileChanges(base, draft, true).map((change) => change.field)).toEqual(["Location"])
        // Not known whether an earlier bio exists: held as well.
        expect(profileChanges(base, draft, null).map((change) => change.field)).toEqual(["Location"])
        expect(profileChanges(base, draft, false).map((change) => change.field)).toEqual(["Bio", "Location"])
        // Replacing the Bio with other text is an ordinary change either way.
        draft.core.bio = "New bio"
        expect(profileChanges(base, draft, true).map((change) => change.field)).toEqual(["Bio", "Location"])
        const request = profilePublishRequest(ADDRESS, base, { ...draftFromChain(base), core: { ...draftFromChain(base).core, bio: "", location: "Paris" } }, FALLBACK_GAS_PRICE, vi.fn(), true)
        expect(request.prepare(undefined).msgs.map((msg) => msg.value.args)).toEqual([["Location", "Paris"]])
    })

    it("moves a draft onto a newer read field by field", () => {
        const draft = draftFromChain(base)
        draft.core.location = "Paris"
        const newer: ProfileChainRead = { ...base, core: { ...base.core, bio: "Published meanwhile", location: "Lyon" }, documentPresent: true, document: { ...defaultProfileDocument(), title: "Lead" } }
        const was = draftFromChain(base), now = draftFromChain(newer)
        const moved = rebaseDraft(draft, was, now)
        // Untouched fields and the untouched layout follow the chain; the edited field stays.
        expect(moved.core).toMatchObject({ displayName: "Alice", bio: "Published meanwhile", location: "Paris" })
        expect(moved.document.title).toBe("Lead")
        expect(profileChanges(newer, moved).map((change) => change.field)).toEqual(["Location"])
        // An edited layout stays the owner's, unless this version must not write the stored one.
        const edited = draftFromChain(base)
        edited.document.title = "Designer"
        expect(rebaseDraft(edited, was, now).document.title).toBe("Designer")
        expect(rebaseDraft(edited, was, now, true).document.title).toBe("Lead")
        expect(rebaseDraft(draftFromChain(base), was, was)).toEqual(was)
    })

    it("still stops when the chain did not return a field or the layout", async () => {
        const draft = draftFromChain(base)
        draft.core.bio = "New bio"
        const request = profilePublishRequest(ADDRESS, base, draft, FALLBACK_GAS_PRICE, vi.fn())
        vi.mocked(readProfileOnChain).mockResolvedValueOnce({ ...base, missingCore: ["location"] })
        await expect(request.recheck?.(undefined)).rejects.toThrow("could not be verified")
        vi.mocked(readProfileOnChain).mockResolvedValueOnce({ ...base, documentUnreadable: true })
        await expect(request.recheck?.(undefined)).rejects.toThrow("could not be verified")
    })

    it("imports the legacy bio over the empty Bio that wallet activation writes, never over a stored value", () => {
        const legacy = { bio: "Backend bio", avatarUrl: "", title: "Builder", company: "Studio", socialLinks: { website: "https://example.org", github: "alice", twitter: "" } } as unknown as UserProfile
        const activated: ProfileChainRead = { ...base, core: { ...base.core, bio: "" } }
        const imported = importLegacyProfile(draftFromChain(activated), activated, legacy)
        expect(imported.core.bio).toBe("Backend bio")
        expect(imported.core.homepage).toBe("https://example.org/")
        expect(importLegacyProfile(draftFromChain(base), base, legacy).core.bio).toBe("Hi")
        expect(imported.document).toMatchObject({ title: "Builder", company: "Studio", links: [{ label: "GitHub", url: "https://github.com/alice" }] })
        // A stored value Memba cannot show is a stored value: import leaves it, and an unreadable or newer layout, alone.
        const unshown: ProfileChainRead = { ...base, core: { ...base.core, bio: null, homepage: null }, invalidCore: ["bio", "homepage"], documentInvalid: true }
        const kept = importLegacyProfile(draftFromChain(unshown), unshown, legacy)
        expect(kept.core).toMatchObject({ bio: "", homepage: "" })
        expect(kept.document).toEqual(defaultProfileDocument())
        expect(profileChanges(unshown, kept)).toEqual([])
        for (const locked of [{ ...base, documentNewer: true }, { ...base, documentOversize: true }] as ProfileChainRead[]) expect(importLegacyProfile(draftFromChain(locked), locked, legacy).document).toEqual(defaultProfileDocument())
    })
})
