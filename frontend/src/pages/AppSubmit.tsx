/**
 * AppSubmit — self-service App Store submission at `/apps/submit` (B3, the money path).
 *
 * Anyone can list an app on the v3 realm by paying the registration fee (read LIVE from
 * `GetRegistrationFee()` — the realm demands an exact coin match, so the client never
 * hardcodes it). The listing starts `pending` and only a curator can make it Verified;
 * that is disclosed before signing AND after broadcast. Rejected listings show the
 * curator's reason here and can be fixed + resubmitted for free (`EditListing`, no coin).
 *
 * Triple-gated: `VITE_ENABLE_APPSTORE_SUBMIT` (ordinary flag — de-gated 2026-07-10
 * after the v3 fee-path checklist passed live), v3 realm active (`isAppStoreV3`), and a
 * connected wallet. Validation mirrors the realm's rules so a transaction the realm
 * would reject is never signed.
 *
 * @module pages/AppSubmit
 */

import { useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useAdena } from "../hooks/useAdena"
import { useAuth } from "../hooks/useAuth"
import { useNetwork } from "../hooks/useNetwork"
import { isAppStoreSubmitEnabled } from "../lib/config"
import { isAppStoreV3, fetchByPublisher, type AppListing } from "../lib/appStore"
import {
    MAX_NAME_LEN,
    MAX_TAGLINE_LEN,
    MAX_DESCR_LEN,
    MAX_CATEGORY_LEN,
    MAX_CID_LEN,
    MAX_SCREENSHOTS,
    validateSubmission,
    buildRegisterAppMsg,
    buildEditListingMsg,
    buildDelistAppMsg,
    fetchRegistrationFee,
    loadEditForm,
    formatGnot,
    type AppSubmission,
} from "../lib/appStoreSubmit"
import { ImageUploader } from "../components/media/ImageUploader"
import { PublisherListings } from "../components/appstore/PublisherListings"
import "./appstore.css"

/** Parse the screenshots CSV into a bare-CID array (blanks dropped). */
function parseShots(csv: string): string[] {
    return csv.split(",").map((s) => s.trim()).filter(Boolean)
}

const EMPTY: AppSubmission = {
    pkgPath: "", name: "", tagline: "", descr: "", category: "", iconCID: "", screenshotsCSV: "", appURL: "",
}

/** register = pay the fee; edit = free resubmit of an existing pending/rejected listing. */
type Mode = { kind: "register" } | { kind: "edit"; pkgPath: string }

export function AppSubmit() {
    const { networkKey } = useNetwork()
    const { connected, address, connect } = useAdena()
    const auth = useAuth()
    const qc = useQueryClient()
    // A console "Edit" hands us the fully-seeded form in router state (already fetched via
    // loadEditForm), so initialise straight into edit mode — read once here, never in an effect
    // (keeps the lint ratchet clean).
    const editFromState = (useLocation().state as { editForm?: AppSubmission } | null)?.editForm ?? null
    const [form, setForm] = useState<AppSubmission>(editFromState ?? EMPTY)
    const [mode, setMode] = useState<Mode>(
        editFromState ? { kind: "edit", pkgPath: editFromState.pkgPath } : { kind: "register" },
    )
    const [done, setDone] = useState<Mode["kind"] | null>(null)
    const [txError, setTxError] = useState<string | null>(null)
    // pkgPath whose full detail is being fetched to open the edit form (null = idle).
    const [editLoading, setEditLoading] = useState<string | null>(null)

    const submitOpen = isAppStoreSubmitEnabled()
    const v3 = isAppStoreV3()

    // The live fee — null means "could not read it", which BLOCKS submission (exact-coin).
    const { data: fee } = useQuery({
        queryKey: ["appStore", "fee"],
        queryFn: fetchRegistrationFee,
        enabled: submitOpen && v3 && connected,
        staleTime: 60_000,
        retry: 1,
    })

    const { data: mineList } = useQuery({
        queryKey: ["appStore", "mine", address],
        queryFn: () => fetchByPublisher(address, 0, 50),
        enabled: submitOpen && v3 && connected && !!address,
        staleTime: 30_000,
        retry: 1,
    })

    const broadcast = useMutation({
        mutationFn: async () => {
            const { doContractBroadcast } = await import("../lib/grc20")
            const msg = mode.kind === "edit"
                ? buildEditListingMsg(address, form)
                : buildRegisterAppMsg(address, fee ?? Number.NaN, form)
            return doContractBroadcast([msg], mode.kind === "edit" ? "Resubmit app" : "Submit app")
        },
        onSuccess: () => {
            // The freshly-signed listing is pending — reflect it immediately (the chain read
            // lags the broadcast), then let the next refetch reconcile.
            const optimistic: AppListing = {
                id: 0, pkgPath: form.pkgPath, name: form.name, tagline: form.tagline,
                category: form.category, iconCID: form.iconCID, appURL: form.appURL,
                publisher: address, status: "pending", flagCount: 0, createdAt: 0, descr: form.descr,
            }
            qc.setQueryData<AppListing[]>(["appStore", "mine", address], (prev) => [
                optimistic,
                ...(prev ?? []).filter((l) => l.pkgPath !== form.pkgPath),
            ])
            void qc.invalidateQueries({ queryKey: ["appStore", "pending"] })
            setDone(mode.kind)
            setTxError(null)
        },
        onError: (e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e)
            if (/denied|rejected by user|cancel/i.test(msg)) {
                setTxError(null) // wallet dismissal is not an error to shout about
            } else if (/already registered/i.test(msg)) {
                setTxError("An app is already listed for this package path.")
            } else {
                setTxError("The transaction didn't go through. Nothing was charged — please try again.")
            }
        },
    })

    // Delist: publisher-initiated, free — but ONE-WAY from the publisher's side
    // (only a curator's RestoreApp revives it, and RegisterApp's duplicate check
    // is status-blind, so the pkgPath stays taken). Hence the armed confirm.
    const [delistArm, setDelistArm] = useState<string | null>(null)
    const [delistError, setDelistError] = useState<string | null>(null)
    const delist = useMutation({
        mutationFn: async (pkgPath: string) => {
            const { doContractBroadcast } = await import("../lib/grc20")
            return doContractBroadcast([buildDelistAppMsg(address, pkgPath)], "Delist app")
        },
        onSuccess: (_res, pkgPath) => {
            // Optimistic flip — the chain read lags the broadcast, so do NOT
            // invalidate "mine" here (a refetch would resurrect the old status);
            // the next natural refetch reconciles. Pending is invalidated so a
            // delisted pending app leaves the curator queue promptly.
            qc.setQueryData<AppListing[]>(["appStore", "mine", address], (prev) =>
                (prev ?? []).map((l) => (l.pkgPath === pkgPath ? { ...l, status: "delisted" } : l)),
            )
            void qc.invalidateQueries({ queryKey: ["appStore", "pending"] })
            setDelistArm(null)
            setDelistError(null)
        },
        onError: (e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e)
            // Stay armed so the error (and a one-click retry) shows exactly where
            // the user acted — the page-level txError is invisible once the "done"
            // panel replaces the form (review F-1). Wallet dismissal stays silent.
            setDelistError(/denied|rejected by user|cancel/i.test(msg)
                ? null
                : "The delist transaction didn't go through — please try again.")
        },
    })

    if (!submitOpen) {
        return (
            <Shell networkKey={networkKey}>
                <div className="appstore__notice" data-testid="appsubmit-gated">
                    <p className="appstore__notice-title">Submissions aren't open yet</p>
                    <p className="appstore__muted">
                        Self-service app listings are coming soon. Until then, curated apps land in the
                        store as they're published.
                    </p>
                </div>
            </Shell>
        )
    }
    if (!v3) {
        return (
            <Shell networkKey={networkKey}>
                <div className="appstore__notice" data-testid="appsubmit-v2">
                    <p className="appstore__notice-title">Submissions need the v3 App Store realm</p>
                    <p className="appstore__muted">
                        This network is still on the previous App Store realm, which has no self-service
                        submission path. Check back after the migration.
                    </p>
                </div>
            </Shell>
        )
    }
    if (!connected) {
        return (
            <Shell networkKey={networkKey}>
                <div className="appstore__notice">
                    <p className="appstore__notice-title">Connect your wallet to submit an app</p>
                    <p className="appstore__muted">
                        Listing an app is an on-chain action: your address becomes the listing's publisher
                        and the fee is paid with the submission.
                    </p>
                    <button type="button" className="appbtn appbtn--primary" onClick={() => void connect()}>
                        Connect wallet
                    </button>
                </div>
            </Shell>
        )
    }

    const errors = validateSubmission(form)
    const requiredFilled = form.pkgPath !== "" && form.name !== ""
    const valid = requiredFilled && Object.keys(errors).length === 0
    const feeOk = typeof fee === "number"
    const canSubmit = valid && !broadcast.isPending && (mode.kind === "edit" || feeOk)

    // Open the free edit/resubmit form for a pending/rejected listing. The My-Submissions list
    // window (ListByPublisherJSON) omits descr + screenshots, and EditListing overwrites EVERY
    // field — so the form MUST be seeded from full on-chain detail (GetListingJSON), never the
    // list row, or a resubmit would silently blank the description and screenshots. If that read
    // fails we abort rather than open a form that would wipe them (fail-closed, like the fee).
    const startResubmit = async (l: AppListing) => {
        setEditLoading(l.pkgPath)
        setTxError(null)
        const seeded = await loadEditForm(l.pkgPath)
        setEditLoading(null)
        if (!seeded) {
            setTxError("Couldn't load this listing's saved details — please try again.")
            return
        }
        setMode({ kind: "edit", pkgPath: seeded.pkgPath })
        setDone(null)
        setForm(seeded)
    }

    const resetToRegister = () => {
        setMode({ kind: "register" })
        setForm(EMPTY)
        setDone(null)
        setTxError(null)
    }

    return (
        <Shell networkKey={networkKey}>
            <header className="appstore__masthead appsubmit__masthead">
                <p className="appstore__eyebrow">Self-service listing</p>
                <h1 className="appstore__headline">Submit your app</h1>
                <p className="appstore__lede">
                    List a gno.land realm in the App Store. Submissions start as{" "}
                    <strong>pending review</strong> — they only become Verified after a curator
                    checks the listing. Most submissions are reviewed within 3 business days.
                </p>
            </header>

            {done ? (
                <div className="appstore__notice appsubmit__done" data-testid="appsubmit-done" role="status">
                    <p className="appstore__notice-title">
                        {done === "edit" ? "Resubmitted — pending review again" : "Submitted — now pending review"}
                    </p>
                    <p className="appstore__muted">
                        Your listing is <strong>pending review</strong>: it is not live in the store yet.
                        A curator will approve it, or reject it with a reason you'll see below — fixing
                        and resubmitting after a rejection is free.
                    </p>
                    <button type="button" className="appbtn appbtn--ghost" onClick={resetToRegister}>
                        Submit another app
                    </button>
                </div>
            ) : (
                <form
                    className="appsubmit__form"
                    onSubmit={(e) => {
                        e.preventDefault()
                        if (canSubmit) broadcast.mutate()
                    }}
                >
                    {mode.kind === "edit" && (
                        <div className="appsubmit__editnote" role="note">
                            Fixing <code className="apppath">{mode.pkgPath}</code> — resubmitting is free
                            and sends it back to review.{" "}
                            <button type="button" className="appsubmit__linkbtn" onClick={resetToRegister}>
                                Cancel
                            </button>
                        </div>
                    )}

                    <Field
                        id="appsubmit-pkgpath" label="Package path" required
                        hint="The app's on-chain realm — the listing's permanent key, e.g. gno.land/r/you/your_app"
                        error={form.pkgPath ? errors.pkgPath : undefined}
                    >
                        <input
                            id="appsubmit-pkgpath" type="text" value={form.pkgPath}
                            disabled={mode.kind === "edit"}
                            placeholder="gno.land/r/you/your_app"
                            onChange={(e) => setForm({ ...form, pkgPath: e.target.value.trim() })}
                        />
                    </Field>
                    <Field
                        id="appsubmit-name" label="Name" required
                        error={form.name.length > MAX_NAME_LEN ? errors.name : undefined}
                    >
                        <input
                            id="appsubmit-name" type="text" value={form.name} maxLength={MAX_NAME_LEN + 1}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                        />
                    </Field>
                    <Field id="appsubmit-tagline" label="Tagline" error={errors.tagline}>
                        <input
                            id="appsubmit-tagline" type="text" value={form.tagline} maxLength={MAX_TAGLINE_LEN + 1}
                            placeholder="One line on what it does"
                            onChange={(e) => setForm({ ...form, tagline: e.target.value })}
                        />
                    </Field>
                    <Field id="appsubmit-category" label="Category" error={errors.category}>
                        <input
                            id="appsubmit-category" type="text" value={form.category} maxLength={MAX_CATEGORY_LEN + 1}
                            placeholder="e.g. Tools, DeFi, Game"
                            onChange={(e) => setForm({ ...form, category: e.target.value })}
                        />
                    </Field>
                    <Field
                        id="appsubmit-url" label="App URL"
                        hint="Where “Open app” goes: https://… or an in-app /path. Leave empty if the realm is the app."
                        error={form.appURL ? errors.appURL : undefined}
                    >
                        <input
                            id="appsubmit-url" type="text" value={form.appURL}
                            placeholder="https://your.app"
                            onChange={(e) => setForm({ ...form, appURL: e.target.value.trim() })}
                        />
                    </Field>
                    <Field
                        id="appsubmit-descr" label="Description"
                        hint="Optional at submission, but curators need it to approve a listing."
                        error={errors.descr}
                    >
                        <textarea
                            id="appsubmit-descr" value={form.descr} rows={5} maxLength={MAX_DESCR_LEN + 1}
                            onChange={(e) => setForm({ ...form, descr: e.target.value })}
                        />
                    </Field>

                    <ArtworkSection form={form} setForm={setForm} authed={auth.isAuthenticated} />

                    {mode.kind === "register" && (
                        feeOk ? (
                            <div className="appsubmit__fee" data-testid="appsubmit-fee" role="note">
                                <strong>{formatGnot(fee)} GNOT listing fee → samcrew treasury.</strong>{" "}
                                Deters spam and funds curation. Not refundable, including if rejected
                                (fixing a rejected listing is free).
                            </div>
                        ) : (
                            <div className="appsubmit__fee appsubmit__fee--error" data-testid="appsubmit-fee-error" role="alert">
                                Couldn't read the listing fee from the realm — submission is disabled.
                                Reload to retry.
                            </div>
                        )
                    )}

                    {txError && <p className="appsubmit__txerror" role="alert">{txError}</p>}

                    <button type="submit" className="appbtn appbtn--primary appsubmit__submit"
                        data-testid="appsubmit-submit" disabled={!canSubmit}>
                        {broadcast.isPending
                            ? "Waiting for wallet…"
                            : mode.kind === "edit"
                                ? "Resubmit for review (free)"
                                : feeOk
                                    ? `Submit for review · ${formatGnot(fee)} GNOT`
                                    : "Submit for review"}
                    </button>
                </form>
            )}

            {mineList && mineList.length > 0 && (
                <section className="appstore__section appsubmit__mine" data-testid="appsubmit-mine">
                    <div className="appsubmit__mineheader">
                        <h2 className="appstore__section-title">My submissions</h2>
                        <Link className="appsubmit__managelink" to={`/${networkKey}/apps/my-submissions`}>
                            Manage all →
                        </Link>
                    </div>
                    <PublisherListings
                        list={mineList}
                        networkKey={networkKey}
                        onResubmit={(l) => { void startResubmit(l) }}
                        editLoading={editLoading}
                        delistArm={delistArm}
                        delistError={delistError}
                        onArmDelist={(p) => { setDelistArm(p); setDelistError(null) }}
                        onConfirmDelist={(pkgPath) => delist.mutate(pkgPath)}
                        delisting={delist.isPending}
                    />
                </section>
            )}
        </Shell>
    )
}

function Shell({ networkKey, children }: { networkKey: string; children: React.ReactNode }) {
    return (
        <div className="appstore appsubmit" data-testid="appsubmit-root">
            <Link className="appstore__back" to={`/${networkKey}/apps`}>← All apps</Link>
            {children}
        </div>
    )
}

function Field({ id, label, required, hint, error, children }: {
    id: string
    label: string
    required?: boolean
    hint?: string
    error?: string
    children: React.ReactNode
}) {
    return (
        <div className="appsubmit__field">
            <label htmlFor={id}>
                {label}{required && <span className="appsubmit__req" aria-hidden="true"> *</span>}
            </label>
            {children}
            {error ? (
                <p className="appsubmit__error" role="alert">{error}</p>
            ) : hint ? (
                <p className="appsubmit__hint">{hint}</p>
            ) : null}
        </div>
    )
}

/**
 * B6 — icon + multi-screenshot uploaders. Each emits a BARE CID into form.iconCID /
 * screenshotsCSV, which flow UNCHANGED through wireArgs → RegisterApp/EditListing.
 * Enforces MAX_SCREENSHOTS + MAX_CID_LEN, and surfaces the backend-auth prerequisite:
 * the upload proxy is auth-gated, so with no session token the uploaders are disabled
 * and a sign-in note shows (auth itself is never weakened — the token is attached
 * server-side at upload time).
 */
function ArtworkSection({ form, setForm, authed }: {
    form: AppSubmission
    setForm: React.Dispatch<React.SetStateAction<AppSubmission>>
    authed: boolean
}) {
    const [artError, setArtError] = useState<string | null>(null)
    const shots = parseShots(form.screenshotsCSV)

    const setIcon = (cid: string) => {
        if (cid.length > MAX_CID_LEN) {
            setArtError(`That icon CID is too long (max ${MAX_CID_LEN} chars).`)
            return
        }
        setArtError(null)
        setForm((f) => ({ ...f, iconCID: cid }))
    }
    const clearIcon = () => { setArtError(null); setForm((f) => ({ ...f, iconCID: "" })) }

    const addShot = (cid: string) => {
        if (cid.length > MAX_CID_LEN) {
            setArtError(`That screenshot CID is too long (max ${MAX_CID_LEN} chars).`)
            return
        }
        const current = parseShots(form.screenshotsCSV)
        if (current.length >= MAX_SCREENSHOTS) {
            setArtError(`At most ${MAX_SCREENSHOTS} screenshots.`)
            return
        }
        if (current.includes(cid)) {
            setArtError("That screenshot is already added.")
            return
        }
        setArtError(null)
        setForm((f) => ({ ...f, screenshotsCSV: [...parseShots(f.screenshotsCSV), cid].join(",") }))
    }
    const removeShot = (cid: string) => {
        setArtError(null)
        setForm((f) => ({ ...f, screenshotsCSV: parseShots(f.screenshotsCSV).filter((c) => c !== cid).join(",") }))
    }

    return (
        <section className="appsubmit__artwork" data-testid="appsubmit-artwork">
            <h2 className="appsubmit__artwork-title">
                Artwork <span className="appsubmit__hint">— optional; images pin to IPFS</span>
            </h2>

            {!authed && (
                <p className="appsubmit__art-authnote" role="note" data-testid="appsubmit-art-authnote">
                    Sign in with your wallet to upload artwork. You can still submit the listing without images.
                </p>
            )}

            <div className="appsubmit__field">
                <label>Icon</label>
                {form.iconCID ? (
                    <div className="appsubmit__art-current" data-testid="appsubmit-icon-current">
                        <code className="apppath">{form.iconCID.slice(0, 16)}…</code>
                        <button type="button" className="appsubmit__linkbtn" onClick={clearIcon}>Remove</button>
                    </div>
                ) : (
                    <ImageUploader
                        label="Icon" testIdPrefix="appsubmit-icon" onUploaded={setIcon} disabled={!authed}
                        hint="A square icon reads best (PNG/WebP/JPEG/GIF, ≤5MB)."
                    />
                )}
            </div>

            <div className="appsubmit__field">
                <label>Screenshots <span className="appsubmit__hint">({shots.length}/{MAX_SCREENSHOTS})</span></label>
                {shots.length > 0 && (
                    <ul className="appsubmit__shots" data-testid="appsubmit-shots">
                        {shots.map((cid) => (
                            <li key={cid} className="appsubmit__shot">
                                <code className="apppath">{cid.slice(0, 14)}…</code>
                                <button type="button" className="appsubmit__linkbtn" onClick={() => removeShot(cid)}>Remove</button>
                            </li>
                        ))}
                    </ul>
                )}
                {shots.length < MAX_SCREENSHOTS ? (
                    <ImageUploader
                        // Remount after each add so the picker resets for the next screenshot.
                        key={`shot-adder-${shots.length}`}
                        label="Screenshot" testIdPrefix="appsubmit-shot" onUploaded={addShot} disabled={!authed}
                        hint={`Add up to ${MAX_SCREENSHOTS} screenshots.`}
                    />
                ) : (
                    <p className="appsubmit__hint" data-testid="appsubmit-shots-full">
                        Maximum {MAX_SCREENSHOTS} screenshots reached.
                    </p>
                )}
            </div>

            {artError && <p className="appsubmit__error" role="alert" data-testid="appsubmit-art-error">{artError}</p>}
        </section>
    )
}
