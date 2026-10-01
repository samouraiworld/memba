import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { GNOLOVE_API_URL, GNO_CHAIN_ID, getUsernameRegistrarPath } from "../../../lib/config"
import { isValidGnoAddressChecksum } from "../../../lib/dao/address"
import { networkGasPriceFresh } from "../../../lib/grc20"
import { resolveUsernameToAddress } from "../../../lib/dao/shared"
import { fetchUserProfile } from "../../../lib/profile"
import { AvatarUploader } from "../../../components/profile/AvatarUploader"
import { AppShell, ErrorState, Loading } from "../../kit"
import type { NativeViewProps } from "../../native/types"
import { useSigner } from "../../sign/signerContext"
import { specForTarget } from "../../shell/windows"
import { ProfileCanvas } from "../../profile/ProfileCanvas"
import { CORE_LIMITS, defaultProfileDocument, layoutLocked, readProfileOnChain, SECTION_LABELS, SECTION_TAB, TAB_NAMES, type CoreField, type ProfileChainRead, type ProfileDocument, type ProfileSection, type ProfileTab, type ProfileTemplate } from "../../profile/profileData"
import { shownProfile } from "../../profile/profileModel"
import { bioClearHeld, canPublishProfileDocument, draftFromChain, importLegacyProfile, profileChanges, profileLockKey, profilePublishEnabled, profilePublishRequest, profileReadIncomplete, rebaseDraft, unpublishedChanges, validateProfileDraft, type ProfileDraft } from "../../profile/profilePublish"
import { usernameLockKey, usernameRegistrationRequest } from "../../profile/profileUsername"
import { useAlive } from "../../shell/useAlive"
import "./native.css"

const SAMPLE_ADDRESS = "sample profile · local preview"
const FIELD_NAMES: Record<CoreField, string> = { displayName: "Display name", bio: "Bio", avatar: "Avatar", homepage: "Homepage", location: "Location" }
const TEMPLATE_NOTES: Record<ProfileTemplate, string> = {
    simple: "One column. Home and DAOs follow the overview.",
    builder: "Two columns on wide windows. Contributions and Home follow the overview.",
    community: "Two columns on wide windows. DAOs and Feed follow the overview.",
}
const sampleChain: ProfileChainRead = {
    core: { displayName: "Your name", bio: "A short introduction to your work and community.", avatar: "", homepage: "", location: "" },
    document: { ...defaultProfileDocument(), title: "Your role" }, documentPresent: true, documentUnreadable: false, documentInvalid: false, documentNewer: false, documentOversize: false, missingCore: [], invalidCore: [],
}

/** The price a review is built on is read from the chain at that click. A cached price can be stale and the fallback can be below the chain's: the recheck would then refuse the review before the wallet. */
async function quoteGasPrice() {
    try { return await networkGasPriceFresh() } catch { throw new Error("The network fee could not be read. Try again in a moment.") }
}


function draftKey(address: string) { return `memba_profile_draft:${GNO_CHAIN_ID}:${address}` }
function hasLocalLock(key: string) { try { return !!localStorage.getItem(key) } catch { return false } }
function restorableDraft(value: unknown): value is ProfileDraft {
    if (!value || typeof value !== "object") return false
    try {
        const draft = value as ProfileDraft
        if (!Array.isArray(draft.document.links) || draft.document.links.length > 5 || !draft.document.links.every((link) => typeof link.label === "string" && link.label.length <= 40 && typeof link.url === "string" && link.url.length <= 256)) return false
        const relaxed: ProfileDraft = {
            core: { ...draft.core, avatar: "", homepage: "" },
            document: { ...draft.document, cover: "", links: draft.document.links.map(() => ({ label: "Draft", url: "https://example.invalid/" })) },
        }
        validateProfileDraft(relaxed)
        return typeof draft.core.avatar === "string" && draft.core.avatar.length <= 256 && typeof draft.core.homepage === "string" && draft.core.homepage.length <= 256 && typeof draft.document.cover === "string" && draft.document.cover.length <= 256
    } catch { return false }
}
/**
 * The saved draft and the read it was made on. A draft holds full values, so without that read a
 * field its owner never touched would come back as a change once the chain has moved on: a draft
 * saved without one (the earlier format) is not restored.
 */
function storedDraft(address: string): { draft: ProfileDraft; on: ProfileDraft } | null {
    try {
        const parsed = JSON.parse(localStorage.getItem(draftKey(address)) ?? "null") as { draft?: unknown; on?: unknown } | null
        return parsed && restorableDraft(parsed.draft) && restorableDraft(parsed.on) ? { draft: parsed.draft, on: parsed.on } : null
    } catch { return null /* malformed or storage blocked: start from the chain */ }
}
/** The saved draft as the publish lock records it, to tell whether it is still the one that was published. */
function storedDraftJson(address: string): string | null {
    const stored = storedDraft(address)
    return stored ? JSON.stringify(stored.draft) : null
}
function loadDraft(address: string, base: ProfileChainRead): ProfileDraft {
    const stored = storedDraft(address)
    return stored ? rebaseDraft(stored.draft, stored.on, draftFromChain(base), layoutLocked(base)) : draftFromChain(base)
}

export default function ProfileWindow({ section, session, open, toast }: NativeViewProps) {
    const signer = useSigner()
    const [mode, setMode] = useState<"view" | "edit" | "try">("view")
    const [lookup, setLookup] = useState("")
    const username = section?.startsWith("u/") ? section.slice(2) : null
    const resolved = useQuery({ queryKey: ["profile", "username", username], queryFn: () => resolveUsernameToAddress(username!), enabled: !!username, retry: false })
    const ownAddress = session.status === "member" ? session.address : null
    const target = section === null ? ownAddress : username ? resolved.data : section
    const address = target && isValidGnoAddressChecksum(target) ? target : null
    const isOwn = !!address && !!ownAddress && address === ownAddress
    const chain = useQuery({ queryKey: ["profile", "chain", GNO_CHAIN_ID, address], queryFn: () => readProfileOnChain(address!), enabled: !!address, retry: false, staleTime: 15_000 })
    // A settled signature re-reads the profile. The last read stays in place meanwhile, and if the
    // re-read fails: an open editor keeps it, its draft and the focus, and moves its untouched
    // fields onto the new read when it lands. The published view waits for the new read.
    const [readAt, setReadAt] = useState(signer.version)
    const { refetch } = chain
    useEffect(() => {
        if (readAt === signer.version || !address) return
        let live = true
        void refetch().finally(() => { if (live) setReadAt(signer.version) })
        return () => { live = false }
    }, [readAt, signer.version, address, refetch])
    const reading = chain.isLoading || (!!address && readAt !== signer.version)
    const legacy = useQuery({ queryKey: ["profile", "legacy", address], queryFn: () => fetchUserProfile(GNOLOVE_API_URL, address!), enabled: !!address, retry: false, staleTime: 60_000 })
    // A failed re-read leaves the last read to the editor only: the published view never shows it as current.
    const published = chain.isError ? null : chain.data ?? null
    const shown = useMemo(() => address ? shownProfile(address, published, legacy.data ?? null) : null, [address, published, legacy.data])
    const browse = () => {
        const value = lookup.trim()
        if (!value) return
        const next = value.startsWith("@") ? `u/${value.slice(1)}` : value
        setMode("view")
        open(specForTarget({ kind: "app", app: "profile", section: next })!)
    }
    const openSelf = () => { setMode("view"); open(specForTarget({ kind: "app", app: "profile", section: null })!) }
    const copyLink = async () => {
        if (!address) return
        try { await navigator.clipboard.writeText(`${location.origin}/os/profile/${address}`); toast("Profile link copied.") }
        catch { toast("Could not copy the link. Use the address in the window URL.") }
    }

    return <AppShell label="Profile" sections={[{ id: "view", name: "Profile", icon: "prof" }, { id: "edit", name: isOwn ? "Edit" : "Try editor", icon: "set" }]}
        current={mode === "view" ? "view" : "edit"} onSelect={(id) => setMode(id === "view" ? "view" : isOwn ? "edit" : "try")}>
        <div className="os-profile" data-testid="os-profile-window">
            {!address && <div className={mode === "try" ? "" : "os-profile-landing"}>
                {mode !== "try" && (username && resolved.isLoading ? <Loading label="Resolving username…" /> : username && !resolved.data ? <p role="status">{resolved.data === "" ? `@${username} is not registered.` : "The username registry is unavailable."}</p> : <>
                    <h2>People on Gno</h2><p>Open a public profile by address or registered @username.</p>
                    {ownAddress ? <button type="button" className="os-btn" onClick={openSelf}>Open my profile</button> : <button type="button" className="os-btn" onClick={session.openConnect}>Connect to create yours</button>}
                </>)}
                {mode !== "try" && <div className="os-profile-search"><label htmlFor="os-profile-lookup">Address or @username</label><div><input id="os-profile-lookup" value={lookup} onChange={(e) => setLookup(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") browse() }} placeholder="g1… or @name" /><button type="button" className="os-btn" onClick={browse}>Open</button></div></div>}
                {mode === "try" && <ProfileEditor key="demo" address={SAMPLE_ADDRESS} base={sampleChain} demo legacy={null} onPublished={() => {}} onConnect={session.openConnect} />}
            </div>}
            {address && <>
                <div className="os-profile-actions">
                    <span>{isOwn ? "Your public profile" : "Public profile"} · {session.network.label}</span>
                    <div><button type="button" className="os-btn os-quiet" onClick={() => void copyLink()}>Copy share link</button>{isOwn && <button type="button" className="os-btn" onClick={() => setMode(mode === "edit" ? "view" : "edit")}>{mode === "edit" ? "View published" : "Edit profile"}</button>}</div>
                </div>
                {mode === "try" && !isOwn ? <ProfileEditor key="demo" address={SAMPLE_ADDRESS} base={sampleChain} demo legacy={null} onPublished={() => {}} onConnect={session.openConnect} /> : mode === "edit" && isOwn && chain.data ? <ProfileEditor key={address} address={address} base={chain.data} legacy={legacy.data ?? null} onPublished={() => { void chain.refetch(); void legacy.refetch(); setMode("view") }} onConnect={session.openConnect} /> : reading ? <Loading label="Reading profile from Gno…" /> : chain.isError && !legacy.data ? <ErrorState message="The profile could not be loaded." onRetry={() => { void chain.refetch(); void legacy.refetch() }} /> : shown && <>{isOwn && !shown.username && <UsernameRegistration address={address} onRegistered={() => { void legacy.refetch() }} />}<ProfileCanvas key={address} profile={shown} /></>}
            </>}
        </div>
    </AppShell>
}

function UsernameRegistration({ address, onRegistered }: { address: string; onRegistered: () => void }) {
    const signer = useSigner()
    const alive = useAlive()
    const [name, setName] = useState("")
    const [error, setError] = useState("")
    const [busy, setBusy] = useState(false)
    const [locked, setLocked] = useState(() => hasLocalLock(usernameLockKey(address)))
    const [canUnlock, setCanUnlock] = useState(false)
    if (!getUsernameRegistrarPath()) return null
    const register = async () => {
        if (busy) return
        setBusy(true); setError("")
        try {
            const request = await usernameRegistrationRequest(address, name, await quoteGasPrice(), (outcome) => {
                if (outcome === "confirmed") { setLocked(false); onRegistered() }
                else if (outcome === "unknown" || outcome === "submitted") { setLocked(true); setError("Registration may be pending. Check the registry before another attempt.") }
            })
            if (alive.current) signer.sign(request)
        } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)) }
        finally { if (alive.current) setBusy(false) }
    }
    const check = async () => {
        setBusy(true); setError("")
        try {
            const stored = JSON.parse(localStorage.getItem(usernameLockKey(address)) || "{}") as { name?: string; at?: number }
            if (!stored.name) throw new Error("No pending username was found.")
            const owner = await resolveUsernameToAddress(stored.name)
            if (owner === address) { localStorage.removeItem(usernameLockKey(address)); setLocked(false); onRegistered() }
            else {
                setCanUnlock(typeof stored.at === "number" && Date.now() - stored.at > 120_000)
                setError("The username is not confirmed for this address yet. Check your wallet transaction before another attempt.")
            }
        } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
        finally { setBusy(false) }
    }
    return <section className="os-profile-register" aria-label="Register username">
        <h2>Claim a registered @username</h2>
        <p className="os-profile-muted">Your display name is editable; a registered username is a separate on-chain claim.</p>
        {locked ? <><button type="button" className="os-btn" disabled={busy} onClick={() => void check()}>{busy ? "Checking…" : "Check pending registration"}</button>{canUnlock && <button type="button" className="os-btn os-quiet" onClick={() => { localStorage.removeItem(usernameLockKey(address)); setLocked(false); setCanUnlock(false); setError("Check your wallet activity before reviewing another registration.") }}>I checked my wallet; review again</button>}</> : <div><label htmlFor="os-profile-nym">Username</label><input id="os-profile-nym" value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="nym-builder042" maxLength={20} disabled={busy} /><button type="button" className="os-btn" aria-disabled={busy} disabled={!name} onClick={() => void register()}>{busy ? "Checking price…" : "Review registration"}</button></div>}
        {error && <p role="alert" className="os-profile-error">{error}</p>}
    </section>
}

function ProfileEditor({ address, base, legacy, demo = false, onPublished, onConnect }: {
    address: string; base: ProfileChainRead; legacy: Awaited<ReturnType<typeof fetchUserProfile>> | null; demo?: boolean; onPublished: () => void; onConnect: () => void
}) {
    const signer = useSigner()
    const alive = useAlive()
    const [quoting, setQuoting] = useState(false)
    const [draft, setDraft] = useState<ProfileDraft>(() => demo ? draftFromChain(base) : loadDraft(address, base))
    const [history, setHistory] = useState<ProfileDraft[]>([])
    const [viewport, setViewport] = useState<"desktop" | "phone">("desktop")
    const [pane, setPane] = useState<"edit" | "preview">("edit")
    const [notice, setNotice] = useState("")
    const [lock, setLock] = useState(() => !demo && hasLocalLock(profileLockKey(address)))
    const [checking, setChecking] = useState(false)
    const [canUnlock, setCanUnlock] = useState(false)
    // The read the draft stands on: the editor's base, once the draft has been moved onto it.
    const seenBase = useRef(base)
    const saveDraft = (next: ProfileDraft) => {
        if (demo) return true
        try { localStorage.setItem(draftKey(address), JSON.stringify({ draft: next, on: draftFromChain(seenBase.current) })); return true } catch { return false }
    }
    // The draft as it is now, for callbacks created earlier: an avatar upload hands its result to
    // the callback it was given when it started, and the fee is read while edits can still land.
    const latest = useRef(draft)
    const show = (next: ProfileDraft) => { latest.current = next; setDraft(next) }
    const update = (next: ProfileDraft) => { const before = latest.current; setHistory((h) => [...h.slice(-19), before]); show(next); setNotice(saveDraft(next) ? "" : "This browser could not save the local draft.") }
    const core = (field: keyof ProfileDraft["core"], value: string) => update({ ...latest.current, core: { ...latest.current.core, [field]: value } })
    const document = (next: ProfileDocument) => update({ ...latest.current, document: next })
    // A newer read of the profile: what the owner did not touch follows it, in the draft, in every
    // Undo step and in the saved draft, so an untouched field is never offered as a change back to
    // an older value. Before paint: that diff is never shown.
    useLayoutEffect(() => {
        const from = seenBase.current
        if (from === base) return
        seenBase.current = base
        const move = (held: ProfileDraft) => rebaseDraft(held, draftFromChain(from), draftFromChain(base), layoutLocked(base))
        setHistory((h) => h.map(move))
        const next = move(latest.current)
        if (JSON.stringify(next) !== JSON.stringify(latest.current)) { latest.current = next; setDraft(next) }
        try { if (localStorage.getItem(draftKey(address)) !== null) localStorage.setItem(draftKey(address), JSON.stringify({ draft: next, on: draftFromChain(base) })) } catch { /* browser storage unavailable */ }
    }, [base, address])
    // Whether an earlier bio would show in place of an empty Bio: null while its sources have not answered.
    const bioFallback = demo ? false : legacy?.bio || legacy?.githubBio ? true : legacy?.bioSourcesRead ? false : null
    const bioHeld = bioClearHeld(base, draft, bioFallback)
    const lockedLayout = !demo && layoutLocked(base)
    const layoutOff = !demo && (!canPublishProfileDocument || lockedLayout)
    const unshown = [...base.invalidCore.map((key) => FIELD_NAMES[key]), ...(base.documentInvalid ? ["your saved layout"] : [])]
    const documentChanged = JSON.stringify(draft.document) !== JSON.stringify(base.document)
    // The preview is what a publish would show: a field never set stays unset, and a Bio clear that is not published leaves the Bio as it is.
    const previewCore = Object.fromEntries((Object.keys(CORE_LIMITS) as CoreField[]).map((key) => [key, key === "bio" && bioHeld ? base.core.bio : base.core[key] === null && draft.core[key] === "" ? null : draft.core[key]])) as ProfileChainRead["core"]
    const previewChain: ProfileChainRead = { ...base, core: previewCore, document: draft.document, documentPresent: base.documentPresent || documentChanged, documentUnreadable: false, documentInvalid: false, documentNewer: false, documentOversize: false, missingCore: [], invalidCore: [] }
    const preview = shownProfile(address, previewChain, legacy)
    let changes: ReturnType<typeof profileChanges> = []
    let error = ""
    try { changes = profileChanges(base, draft, bioFallback) } catch (e) { error = e instanceof Error ? e.message : String(e) }
    // The fields are inert while the fee is quoted, so the review shows the draft as it is, once.
    const publish = async () => {
        if (demo) { onConnect(); return }
        if (quoting) return
        if (!profilePublishEnabled) { setNotice("On-chain publishing is awaiting the wallet and gas rehearsal."); return }
        const reviewed = latest.current
        const submittedDraft = JSON.stringify(reviewed)
        setQuoting(true); setNotice("")
        try {
            const price = await quoteGasPrice()
            // The editor may have closed while the price was read: no sheet for a draft that is off screen.
            if (!alive.current) return
            if (latest.current !== reviewed) { setNotice("Your draft changed while the fee was read. Check it, then publish again."); return }
            signer.sign(profilePublishRequest(address, base, reviewed, price, (outcome) => {
                if (outcome === "confirmed") {
                    try { if (storedDraftJson(address) === submittedDraft) localStorage.removeItem(draftKey(address)) } catch { /* browser storage unavailable */ }
                    setLock(false); onPublished()
                } else if (outcome === "unknown" || outcome === "submitted") { setLock(true); setNotice("Publication may be pending. Check the chain before another attempt.") }
            }, bioFallback))
        } catch (e) { if (alive.current) setNotice(e instanceof Error ? e.message : String(e)) }
        finally { if (alive.current) setQuoting(false) }
    }
    const checkLock = async () => {
        setChecking(true)
        try {
            const latest = await readProfileOnChain(address)
            if (profileReadIncomplete(latest)) throw new Error("Chain read incomplete")
            const stored = JSON.parse(localStorage.getItem(profileLockKey(address)) || "{}") as { changes?: { field: string; after: string }[]; draft?: string; at?: number }
            if (stored.changes?.length && unpublishedChanges(latest, stored.changes).length === 0) {
                localStorage.removeItem(profileLockKey(address))
                if (stored.draft && storedDraftJson(address) === stored.draft) localStorage.removeItem(draftKey(address))
                setLock(false); setNotice("Your changes are visible on chain."); onPublished()
            } else {
                setCanUnlock(typeof stored.at === "number" && Date.now() - stored.at > 120_000)
                setNotice("The changes are not fully visible on chain yet. Check the transaction in your wallet before another attempt.")
            }
        } catch { setNotice("The chain could not be checked. Publication remains locked.") }
        finally { setChecking(false) }
    }
    const tabSections = (tab: ProfileTab) => draft.document.sections.filter((section) => SECTION_TAB[section] === tab)
    // A section trades places with its neighbour in the same tab: that is the only order the canvas shows.
    const move = (section: ProfileSection, by: number) => {
        const group = tabSections(SECTION_TAB[section])
        const other = group[group.indexOf(section) + by]
        if (other) document({ ...draft.document, sections: draft.document.sections.map((item) => item === section ? other : item === other ? section : item) })
    }
    return <div className="os-profile-editor" data-pane={pane} data-testid="os-profile-editor">
        <div className="os-profile-pane-switch" role="group" aria-label="Editor pane"><button type="button" aria-pressed={pane === "edit"} onClick={() => setPane("edit")}>Edit</button><button type="button" aria-pressed={pane === "preview"} onClick={() => setPane("preview")}>Preview</button></div>
        <div className="os-profile-controls">
            {/* The publish button stays outside the inert fields and focusable: the sheet returns focus to it. */}
            <div className="os-profile-fields" inert={quoting}>
            <h2>{demo ? "Try the editor" : "Edit your profile"}</h2>
            <p className="os-profile-muted">Changes appear in the preview and save locally. Publishing writes public data to Gno.</p>
            {demo && <p className="os-profile-notice">Sample only. Connect to edit your own address; this sample is never published.</p>}
            {!demo && legacy && <><button type="button" className="os-btn os-quiet" onClick={() => update(importLegacyProfile(latest.current, base, legacy))}>Import available Memba details</button><p className="os-profile-muted">Imports details into fields you have never published, and into an empty bio. Review them in the canvas and wallet sheet before making them public.</p></>}
            {!demo && profilePublishEnabled && unshown.length > 0 && <p className="os-profile-notice" role="status">Memba cannot show what is stored on chain for {unshown.join(", ")}: it is too long, or not a layout this version reads. It stays on chain as it is. To replace it, enter a new value here (or change the layout); the review sheet marks each replacement. What you leave empty is not touched.</p>}
            {lockedLayout && <p className="os-profile-notice" role="status">{base.documentOversize
                ? "Your saved layout is too large for this version of Memba to read. It shows the default layout and cannot change yours."
                : "Your layout was saved by a newer version of Memba. This version shows the default layout and cannot change yours: reload Memba to edit it."}{profilePublishEnabled && " Your name, bio and other fields can still be published."}</p>}
            <div className="os-profile-form">
                <label>Display name<input maxLength={CORE_LIMITS.displayName} value={draft.core.displayName} onChange={(e) => core("displayName", e.target.value)} /></label>
                <label>Bio<textarea maxLength={CORE_LIMITS.bio} rows={4} value={draft.core.bio} onChange={(e) => core("bio", e.target.value)} aria-describedby={bioHeld ? "os-profile-bio-held" : undefined} /></label>
                {bioHeld && <p id="os-profile-bio-held" className="os-profile-muted">{bioFallback ? "An empty bio would show your earlier Memba or GitHub bio in its place, so clearing it is not published. Write a different bio to replace it." : "Clearing the bio is on hold: your earlier Memba and GitHub details have not been read, and an earlier bio would show in its place."}</p>}
                <label>Location<input maxLength={CORE_LIMITS.location} value={draft.core.location} onChange={(e) => core("location", e.target.value)} /></label>
                <label>Homepage URL<input type="url" maxLength={CORE_LIMITS.homepage} placeholder="https://" value={draft.core.homepage} onChange={(e) => core("homepage", e.target.value)} /></label>
                <AvatarUploader currentUrl={draft.core.avatar} onUrlChange={(url) => core("avatar", url)} />
                <label>Title<input maxLength={128} value={draft.document.title} onChange={(e) => document({ ...draft.document, title: e.target.value })} disabled={layoutOff} /></label>
                <label>Company<input maxLength={128} value={draft.document.company} onChange={(e) => document({ ...draft.document, company: e.target.value })} disabled={layoutOff} /></label>
                <label>Cover image URL<input type="url" maxLength={256} placeholder="https://" value={draft.document.cover} onChange={(e) => document({ ...draft.document, cover: e.target.value })} disabled={layoutOff} /></label>
            </div>
            <h3>Presentation</h3>
            <div className="os-profile-choices" role="group" aria-label="Profile template">{(["simple", "builder", "community"] as const).map((value) => <button type="button" key={value} aria-pressed={draft.document.template === value} disabled={layoutOff} onClick={() => document({ ...draft.document, template: value })}>{value}</button>)}</div>
            <p className="os-profile-muted">{TEMPLATE_NOTES[draft.document.template]}</p>
            <div className="os-profile-choices" role="group" aria-label="Accent color">{(["indigo", "teal", "rose", "amber"] as const).map((value) => <button type="button" key={value} aria-pressed={draft.document.accent === value} disabled={layoutOff} onClick={() => document({ ...draft.document, accent: value })}>{value}</button>)}</div>
            <h3>Links</h3>
            {draft.document.links.map((link, index) => <div className="os-profile-link-edit" key={index}><input aria-label={`Link ${index + 1} label`} placeholder="Label" maxLength={40} value={link.label} disabled={layoutOff} onChange={(e) => document({ ...draft.document, links: draft.document.links.map((v, i) => i === index ? { ...v, label: e.target.value } : v) })} /><input aria-label={`Link ${index + 1} URL`} type="url" placeholder="https://" maxLength={256} value={link.url} disabled={layoutOff} onChange={(e) => document({ ...draft.document, links: draft.document.links.map((v, i) => i === index ? { ...v, url: e.target.value } : v) })} /><button type="button" aria-label={`Remove link ${index + 1}`} disabled={layoutOff} onClick={() => document({ ...draft.document, links: draft.document.links.filter((_, i) => i !== index) })}>Remove</button></div>)}
            <button type="button" className="os-btn os-quiet" disabled={draft.document.links.length >= 5 || layoutOff} onClick={() => document({ ...draft.document, links: [...draft.document.links, { label: "", url: "" }] })}>Add link</button>
            <h3>Sections</h3>
            {(["overview", "daos", "feed"] as const).map((tab) => {
                const group = tabSections(tab)
                return <ul key={tab} className="os-profile-order" aria-label={`${TAB_NAMES[tab]} tab sections`}>{group.map((section, index) => <li key={section}><span>{SECTION_LABELS[section]} <small>· {TAB_NAMES[tab]} tab</small></span><div>{group.length > 1 && <><button type="button" aria-label={`Move ${SECTION_LABELS[section]} up`} disabled={index === 0 || layoutOff} onClick={() => move(section, -1)}>↑</button><button type="button" aria-label={`Move ${SECTION_LABELS[section]} down`} disabled={index === group.length - 1 || layoutOff} onClick={() => move(section, 1)}>↓</button></>}<label><input type="checkbox" checked={!draft.document.hidden.includes(section)} disabled={layoutOff} onChange={(e) => document({ ...draft.document, hidden: e.target.checked ? draft.document.hidden.filter((s) => s !== section) : [...draft.document.hidden, section] })} /> Show</label></div></li>)}</ul>
            })}
            {!canPublishProfileDocument && !demo && <p className="os-profile-notice">This network supports standard profile fields only. Layout and extra fields are available on mainnet.</p>}
            <div className="os-profile-save"><button type="button" className="os-btn os-quiet" disabled={!history.length} onClick={() => { const last = history.at(-1); if (last) { show(last); saveDraft(last); setHistory(history.slice(0, -1)) } }}>Undo</button><button type="button" className="os-btn os-quiet" onClick={() => update(draftFromChain(base))}>Reset to published</button></div>
            </div>
            {error && <p className="os-profile-error" role="alert">{error}</p>}
            {notice && <p className="os-profile-notice" role="status">{notice}</p>}
            {!demo && !profilePublishEnabled && <p className="os-profile-notice" role="status">Publishing is awaiting a wallet and gas rehearsal. You can edit and keep a local draft now.</p>}
            {lock ? <div className="os-profile-notice"><p>A previous publish is pending or uncertain. Review chain state before another attempt.</p><button type="button" className="os-btn" disabled={checking} onClick={() => void checkLock()}>{checking ? "Checking…" : "Check published state"}</button>{canUnlock && <button type="button" className="os-btn os-quiet" onClick={() => { localStorage.removeItem(profileLockKey(address)); setLock(false); setCanUnlock(false); setNotice("Review the latest profile and your wallet activity before publishing again.") }}>I checked my wallet; review again</button>}</div> : <button type="button" className="os-btn" aria-disabled={quoting} disabled={!demo && (!profilePublishEnabled || !!error || changes.length === 0)} onClick={() => void publish()}>{demo ? "Connect to create yours" : quoting ? "Checking fee…" : `Review & publish ${changes.length} change${changes.length === 1 ? "" : "s"}`}</button>}
            {!demo && <p className="os-profile-muted">Local draft · {GNO_CHAIN_ID} · {address}</p>}
        </div>
        <div className="os-profile-preview"><div className="os-profile-preview-bar"><strong>Live preview</strong><div role="group" aria-label="Preview width"><button type="button" aria-pressed={viewport === "desktop"} onClick={() => setViewport("desktop")}>Desktop</button><button type="button" aria-pressed={viewport === "phone"} onClick={() => setViewport("phone")}>Phone</button></div></div><div className={viewport === "phone" ? "os-profile-phone" : ""}><ProfileCanvas profile={preview} preview={demo} /></div></div>
    </div>
}
