import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { GNOLOVE_API_URL, GNO_CHAIN_ID, getUsernameRegistrarPath } from "../../../lib/config"
import { isValidGnoAddressChecksum } from "../../../lib/dao/address"
import { resolveUsernameToAddress } from "../../../lib/dao/shared"
import { fetchUserProfile } from "../../../lib/profile"
import { AvatarUploader } from "../../../components/profile/AvatarUploader"
import { resolveAvatarUrl } from "../../../lib/ipfs"
import { AppShell, ErrorState, Loading } from "../../kit"
import type { NativeViewProps } from "../../native/types"
import { useSigner } from "../../sign/signerContext"
import { specForTarget } from "../../shell/windows"
import { ProfileCanvas } from "../../profile/ProfileCanvas"
import { ALL_SECTIONS, CORE_LIMITS, defaultProfileDocument, readProfileOnChain, safeProfileUrl, type ProfileChainRead, type ProfileDocument, type ProfileSection } from "../../profile/profileData"
import { shownProfile } from "../../profile/profileModel"
import { canPublishProfileDocument, draftFromChain, profileChanges, profileLockKey, profilePublishEnabled, profilePublishRequest, validateProfileDraft, type ProfileDraft } from "../../profile/profilePublish"
import { usernameLockKey, usernameRegistrationRequest } from "../../profile/profileUsername"
import "./native.css"

const SAMPLE_ADDRESS = "sample profile · local preview"
const SECTION_NAMES: Record<ProfileSection, string> = { about: "About", links: "Links", daos: "Projects", votes: "Votes", assets: "Assets", credentials: "Credentials", feed: "Feed", reviews: "Reviews" }
const sampleChain: ProfileChainRead = {
    core: { displayName: "Your name", bio: "A short introduction to your work and community.", avatar: "", homepage: "", location: "" },
    document: { ...defaultProfileDocument(), title: "Your role" }, documentPresent: true, documentProblem: false, missingCore: [],
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
function loadDraft(address: string, base: ProfileChainRead): ProfileDraft {
    try {
        const raw = localStorage.getItem(draftKey(address))
        if (raw) {
            const parsed = JSON.parse(raw) as unknown
            if (!restorableDraft(parsed)) throw new Error("Invalid local draft")
            return parsed
        }
    } catch { /* malformed or storage blocked: start from the chain */ }
    return draftFromChain(base)
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
    const chain = useQuery({ queryKey: ["profile", "chain", GNO_CHAIN_ID, address, signer.version], queryFn: () => readProfileOnChain(address!), enabled: !!address, retry: false, staleTime: 15_000 })
    const legacy = useQuery({ queryKey: ["profile", "legacy", address], queryFn: () => fetchUserProfile(GNOLOVE_API_URL, address!), enabled: !!address, retry: false, staleTime: 60_000 })
    const shown = useMemo(() => address ? shownProfile(address, chain.data ?? null, legacy.data ?? null) : null, [address, chain.data, legacy.data])
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
                {mode === "try" && !isOwn ? <ProfileEditor key="demo" address={SAMPLE_ADDRESS} base={sampleChain} demo legacy={null} onPublished={() => {}} onConnect={session.openConnect} /> : chain.isLoading && !chain.data ? <Loading label="Reading profile from Gno…" /> : chain.isError && !legacy.data ? <ErrorState message="The profile could not be loaded." onRetry={() => { void chain.refetch(); void legacy.refetch() }} /> : mode === "edit" && isOwn && chain.data ? <ProfileEditor key={`${address}:${signer.version}`} address={address} base={chain.data} legacy={legacy.data ?? null} onPublished={() => { void chain.refetch(); void legacy.refetch(); setMode("view") }} onConnect={session.openConnect} /> : shown && <>{isOwn && !shown.username && <UsernameRegistration address={address} onRegistered={() => { void legacy.refetch() }} />}<ProfileCanvas key={address} profile={shown} /></>}
            </>}
        </div>
    </AppShell>
}

function UsernameRegistration({ address, onRegistered }: { address: string; onRegistered: () => void }) {
    const signer = useSigner()
    const [name, setName] = useState("")
    const [error, setError] = useState("")
    const [busy, setBusy] = useState(false)
    const [locked, setLocked] = useState(() => hasLocalLock(usernameLockKey(address)))
    const [canUnlock, setCanUnlock] = useState(false)
    if (!getUsernameRegistrarPath()) return null
    const register = async () => {
        setBusy(true); setError("")
        try {
            const request = await usernameRegistrationRequest(address, name, (outcome) => {
                if (outcome === "confirmed") { setLocked(false); onRegistered() }
                else if (outcome === "unknown" || outcome === "submitted") { setLocked(true); setError("Registration may be pending. Check the registry before another attempt.") }
            })
            signer.sign(request)
        } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
        finally { setBusy(false) }
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
        {locked ? <><button type="button" className="os-btn" disabled={busy} onClick={() => void check()}>{busy ? "Checking…" : "Check pending registration"}</button>{canUnlock && <button type="button" className="os-btn os-quiet" onClick={() => { localStorage.removeItem(usernameLockKey(address)); setLocked(false); setCanUnlock(false); setError("Check your wallet activity before reviewing another registration.") }}>I checked my wallet; review again</button>}</> : <div><label htmlFor="os-profile-nym">Username</label><input id="os-profile-nym" value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="nym-builder042" maxLength={20} /><button type="button" className="os-btn" disabled={busy || !name} onClick={() => void register()}>{busy ? "Checking price…" : "Review registration"}</button></div>}
        {error && <p role="alert" className="os-profile-error">{error}</p>}
    </section>
}

function ProfileEditor({ address, base, legacy, demo = false, onPublished, onConnect }: {
    address: string; base: ProfileChainRead; legacy: Awaited<ReturnType<typeof fetchUserProfile>> | null; demo?: boolean; onPublished: () => void; onConnect: () => void
}) {
    const signer = useSigner()
    const [draft, setDraft] = useState<ProfileDraft>(() => demo ? draftFromChain(base) : loadDraft(address, base))
    const [history, setHistory] = useState<ProfileDraft[]>([])
    const [viewport, setViewport] = useState<"desktop" | "phone">("desktop")
    const [pane, setPane] = useState<"edit" | "preview">("edit")
    const [notice, setNotice] = useState("")
    const [lock, setLock] = useState(() => !demo && hasLocalLock(profileLockKey(address)))
    const [checking, setChecking] = useState(false)
    const [canUnlock, setCanUnlock] = useState(false)
    const saveDraft = (next: ProfileDraft) => {
        if (demo) return true
        try { localStorage.setItem(draftKey(address), JSON.stringify(next)); return true } catch { return false }
    }
    const update = (next: ProfileDraft) => { setHistory((h) => [...h.slice(-19), draft]); setDraft(next); setNotice(saveDraft(next) ? "" : "This browser could not save the local draft.") }
    const core = (field: keyof ProfileDraft["core"], value: string) => update({ ...draft, core: { ...draft.core, [field]: value } })
    const document = (next: ProfileDocument) => update({ ...draft, document: next })
    const documentChanged = JSON.stringify(draft.document) !== JSON.stringify(base.document)
    const previewCore = Object.fromEntries((Object.keys(CORE_LIMITS) as (keyof ProfileDraft["core"])[]).map((key) => [key, base.core[key] === null && draft.core[key] === "" ? null : draft.core[key]])) as ProfileChainRead["core"]
    const previewChain: ProfileChainRead = { ...base, core: previewCore, document: draft.document, documentPresent: base.documentPresent || documentChanged, documentProblem: false, missingCore: [] }
    const preview = shownProfile(address, previewChain, legacy)
    let changes: ReturnType<typeof profileChanges> = []
    let error = ""
    try { changes = profileChanges(base, draft) } catch (e) { error = e instanceof Error ? e.message : String(e) }
    const publish = () => {
        if (demo) { onConnect(); return }
        if (!profilePublishEnabled) { setNotice("On-chain publishing is awaiting the wallet and gas rehearsal."); return }
        const submittedDraft = JSON.stringify(draft)
        try {
            signer.sign(profilePublishRequest(address, base, draft, (outcome) => {
                if (outcome === "confirmed") {
                    try { if (localStorage.getItem(draftKey(address)) === submittedDraft) localStorage.removeItem(draftKey(address)) } catch { /* browser storage unavailable */ }
                    setLock(false); onPublished()
                } else if (outcome === "unknown" || outcome === "submitted") { setLock(true); setNotice("Publication may be pending. Check the chain before another attempt.") }
            }))
        } catch (e) { setNotice(e instanceof Error ? e.message : String(e)) }
    }
    const checkLock = async () => {
        setChecking(true)
        try {
            const latest = await readProfileOnChain(address)
            if (latest.missingCore.length || latest.documentProblem) throw new Error("Chain read incomplete")
            const stored = JSON.parse(localStorage.getItem(profileLockKey(address)) || "{}") as { changes?: { field: string; after: string }[]; draft?: string; at?: number }
            const remaining = stored.changes?.filter(({ field, after }) => {
                if (field === "memba.profile.v1") return JSON.stringify(latest.document) !== after
                const key = (Object.keys(CORE_LIMITS) as (keyof ProfileDraft["core"])[]).find((k) => field.toLowerCase() === k.toLowerCase())
                return key ? latest.core[key] !== after : true
            }) ?? []
            if (stored.changes?.length && remaining.length === 0) {
                localStorage.removeItem(profileLockKey(address))
                if (stored.draft && localStorage.getItem(draftKey(address)) === stored.draft) localStorage.removeItem(draftKey(address))
                setLock(false); setNotice("Your changes are visible on chain."); onPublished()
            } else {
                setCanUnlock(typeof stored.at === "number" && Date.now() - stored.at > 120_000)
                setNotice("The changes are not fully visible on chain yet. Check the transaction in your wallet before another attempt.")
            }
        } catch { setNotice("The chain could not be checked. Publication remains locked.") }
        finally { setChecking(false) }
    }
    const importLegacy = () => {
        if (!legacy) return
        const next = structuredClone(draft)
        if (base.core.bio === null && legacy.bio) next.core.bio = legacy.bio.slice(0, CORE_LIMITS.bio)
        const avatar = safeProfileUrl(resolveAvatarUrl(legacy.avatarUrl))
        if (base.core.avatar === null && avatar) next.core.avatar = avatar
        const homepage = safeProfileUrl(legacy.socialLinks.website)
        if (base.core.homepage === null && homepage) next.core.homepage = homepage
        if (!base.documentPresent && canPublishProfileDocument) {
            next.document.title = legacy.title.slice(0, 128)
            next.document.company = legacy.company.slice(0, 128)
            const social = [
                { label: "GitHub", value: legacy.socialLinks.github, host: "github.com" },
                { label: "X", value: legacy.socialLinks.twitter, host: "x.com" },
            ]
            next.document.links = social.flatMap(({ label, value, host }) => {
                if (!value) return []
                const handle = value.replace(/^@/, "")
                const candidate = value.startsWith("https://") ? value : /^[A-Za-z0-9_.-]{1,64}$/.test(handle) ? `https://${host}/${handle}` : ""
                const url = safeProfileUrl(candidate)
                return url && new URL(url).hostname === host ? [{ label, url }] : []
            }).slice(0, 5)
        }
        update(next)
    }
    const move = (section: ProfileSection, by: number) => {
        const sections = [...draft.document.sections]
        const index = sections.indexOf(section), next = index + by
        if (next < 0 || next >= sections.length) return
        ;[sections[index], sections[next]] = [sections[next], sections[index]]
        document({ ...draft.document, sections })
    }
    return <div className="os-profile-editor" data-pane={pane} data-testid="os-profile-editor">
        <div className="os-profile-pane-switch" role="group" aria-label="Editor pane"><button type="button" aria-pressed={pane === "edit"} onClick={() => setPane("edit")}>Edit</button><button type="button" aria-pressed={pane === "preview"} onClick={() => setPane("preview")}>Preview</button></div>
        <div className="os-profile-controls">
            <h2>{demo ? "Try the editor" : "Edit your profile"}</h2>
            <p className="os-profile-muted">Changes appear in the preview and save locally. Publishing writes public data to Gno.</p>
            {demo && <p className="os-profile-notice">Sample only. Connect to edit your own address; this sample is never published.</p>}
            {!demo && legacy && <><button type="button" className="os-btn os-quiet" onClick={importLegacy}>Import available Memba details</button><p className="os-profile-muted">Imports only fields absent on chain. Review them in the canvas and wallet sheet before making them public.</p></>}
            <div className="os-profile-form">
                <label>Display name<input maxLength={CORE_LIMITS.displayName} value={draft.core.displayName} onChange={(e) => core("displayName", e.target.value)} /></label>
                <label>Bio<textarea maxLength={CORE_LIMITS.bio} rows={4} value={draft.core.bio} onChange={(e) => core("bio", e.target.value)} /></label>
                <label>Location<input maxLength={CORE_LIMITS.location} value={draft.core.location} onChange={(e) => core("location", e.target.value)} /></label>
                <label>Homepage URL<input type="url" maxLength={CORE_LIMITS.homepage} placeholder="https://" value={draft.core.homepage} onChange={(e) => core("homepage", e.target.value)} /></label>
                <AvatarUploader currentUrl={draft.core.avatar} onUrlChange={(url) => core("avatar", url)} />
                <label>Title<input maxLength={128} value={draft.document.title} onChange={(e) => document({ ...draft.document, title: e.target.value })} disabled={!canPublishProfileDocument && !demo} /></label>
                <label>Company<input maxLength={128} value={draft.document.company} onChange={(e) => document({ ...draft.document, company: e.target.value })} disabled={!canPublishProfileDocument && !demo} /></label>
                <label>Cover image URL<input type="url" maxLength={256} placeholder="https://" value={draft.document.cover} onChange={(e) => document({ ...draft.document, cover: e.target.value })} disabled={!canPublishProfileDocument && !demo} /></label>
            </div>
            <h3>Presentation</h3>
            <div className="os-profile-choices" role="group" aria-label="Profile template">{(["simple", "builder", "community"] as const).map((value) => <button type="button" key={value} aria-pressed={draft.document.template === value} disabled={!canPublishProfileDocument && !demo} onClick={() => document({ ...defaultProfileDocument(value), title: draft.document.title, company: draft.document.company, cover: draft.document.cover, links: draft.document.links, accent: draft.document.accent })}>{value}</button>)}</div>
            <div className="os-profile-choices" role="group" aria-label="Accent color">{(["indigo", "teal", "rose", "amber"] as const).map((value) => <button type="button" key={value} aria-pressed={draft.document.accent === value} disabled={!canPublishProfileDocument && !demo} onClick={() => document({ ...draft.document, accent: value })}>{value}</button>)}</div>
            <h3>Links</h3>
            {draft.document.links.map((link, index) => <div className="os-profile-link-edit" key={index}><input aria-label={`Link ${index + 1} label`} placeholder="Label" maxLength={40} value={link.label} onChange={(e) => document({ ...draft.document, links: draft.document.links.map((v, i) => i === index ? { ...v, label: e.target.value } : v) })} /><input aria-label={`Link ${index + 1} URL`} type="url" placeholder="https://" maxLength={256} value={link.url} onChange={(e) => document({ ...draft.document, links: draft.document.links.map((v, i) => i === index ? { ...v, url: e.target.value } : v) })} /><button type="button" aria-label={`Remove link ${index + 1}`} onClick={() => document({ ...draft.document, links: draft.document.links.filter((_, i) => i !== index) })}>Remove</button></div>)}
            <button type="button" className="os-btn os-quiet" disabled={draft.document.links.length >= 5 || (!canPublishProfileDocument && !demo)} onClick={() => document({ ...draft.document, links: [...draft.document.links, { label: "", url: "" }] })}>Add link</button>
            <h3>Sections</h3>
            <ul className="os-profile-order">{draft.document.sections.map((section, index) => <li key={section}><span>{SECTION_NAMES[section]}</span><div><button type="button" aria-label={`Move ${SECTION_NAMES[section]} up`} disabled={index === 0 || (!canPublishProfileDocument && !demo)} onClick={() => move(section, -1)}>↑</button><button type="button" aria-label={`Move ${SECTION_NAMES[section]} down`} disabled={index === ALL_SECTIONS.length - 1 || (!canPublishProfileDocument && !demo)} onClick={() => move(section, 1)}>↓</button><label><input type="checkbox" checked={!draft.document.hidden.includes(section)} disabled={!canPublishProfileDocument && !demo} onChange={(e) => document({ ...draft.document, hidden: e.target.checked ? draft.document.hidden.filter((s) => s !== section) : [...draft.document.hidden, section] })} /> Show</label></div></li>)}</ul>
            {!canPublishProfileDocument && !demo && <p className="os-profile-notice">This network supports standard profile fields only. Layout and extra fields are available on mainnet.</p>}
            <div className="os-profile-save"><button type="button" className="os-btn os-quiet" disabled={!history.length} onClick={() => { const last = history.at(-1); if (last) { setDraft(last); saveDraft(last); setHistory(history.slice(0, -1)) } }}>Undo</button><button type="button" className="os-btn os-quiet" onClick={() => update(draftFromChain(base))}>Reset to published</button></div>
            {error && <p className="os-profile-error" role="alert">{error}</p>}
            {notice && <p className="os-profile-notice" role="status">{notice}</p>}
            {!demo && !profilePublishEnabled && <p className="os-profile-notice" role="status">Publishing is awaiting a wallet and gas rehearsal. You can edit and keep a local draft now.</p>}
            {lock ? <div className="os-profile-notice"><p>A previous publish is pending or uncertain. Review chain state before another attempt.</p><button type="button" className="os-btn" disabled={checking} onClick={() => void checkLock()}>{checking ? "Checking…" : "Check published state"}</button>{canUnlock && <button type="button" className="os-btn os-quiet" onClick={() => { localStorage.removeItem(profileLockKey(address)); setLock(false); setCanUnlock(false); setNotice("Review the latest profile and your wallet activity before publishing again.") }}>I checked my wallet; review again</button>}</div> : <button type="button" className="os-btn" disabled={!demo && (!profilePublishEnabled || !!error || changes.length === 0)} onClick={publish}>{demo ? "Connect to create yours" : `Review & publish ${changes.length} change${changes.length === 1 ? "" : "s"}`}</button>}
            {!demo && <p className="os-profile-muted">Local draft · {GNO_CHAIN_ID} · {address}</p>}
        </div>
        <div className="os-profile-preview"><div className="os-profile-preview-bar"><strong>Live preview</strong><div role="group" aria-label="Preview width"><button type="button" aria-pressed={viewport === "desktop"} onClick={() => setViewport("desktop")}>Desktop</button><button type="button" aria-pressed={viewport === "phone"} onClick={() => setViewport("phone")}>Phone</button></div></div><div className={viewport === "phone" ? "os-profile-phone" : ""}><ProfileCanvas profile={preview} preview={demo} /></div></div>
    </div>
}
