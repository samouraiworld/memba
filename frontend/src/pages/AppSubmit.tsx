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
import { Link } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useAdena } from "../hooks/useAdena"
import { useNetwork } from "../hooks/useNetwork"
import { isAppStoreSubmitEnabled } from "../lib/config"
import { isAppStoreV3, fetchByPublisher, type AppListing } from "../lib/appStore"
import {
    MAX_NAME_LEN,
    MAX_TAGLINE_LEN,
    MAX_DESCR_LEN,
    MAX_CATEGORY_LEN,
    validateSubmission,
    buildRegisterAppMsg,
    buildEditListingMsg,
    buildDelistAppMsg,
    fetchRegistrationFee,
    formatGnot,
    type AppSubmission,
} from "../lib/appStoreSubmit"
import "./appstore.css"

const EMPTY: AppSubmission = {
    pkgPath: "", name: "", tagline: "", descr: "", category: "", iconCID: "", screenshotsCSV: "", appURL: "",
}

/** register = pay the fee; edit = free resubmit of an existing pending/rejected listing. */
type Mode = { kind: "register" } | { kind: "edit"; pkgPath: string }

export function AppSubmit() {
    const { networkKey } = useNetwork()
    const { connected, address, connect } = useAdena()
    const qc = useQueryClient()
    const [form, setForm] = useState<AppSubmission>(EMPTY)
    const [mode, setMode] = useState<Mode>({ kind: "register" })
    const [done, setDone] = useState<Mode["kind"] | null>(null)
    const [txError, setTxError] = useState<string | null>(null)

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
            setTxError(null)
        },
        onError: (e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e)
            setTxError(/denied|rejected by user|cancel/i.test(msg)
                ? null
                : "The delist transaction didn't go through — please try again.")
            setDelistArm(null)
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

    const startResubmit = (l: AppListing) => {
        setMode({ kind: "edit", pkgPath: l.pkgPath })
        setDone(null)
        setTxError(null)
        setForm({
            pkgPath: l.pkgPath,
            name: l.name,
            tagline: l.tagline,
            descr: l.descr ?? "",
            category: l.category,
            // Preserve artwork the wire form doesn't expose — EditListing overwrites every field.
            iconCID: l.iconCID,
            screenshotsCSV: (l.screenshotCIDs ?? []).join(","),
            appURL: l.appURL,
        })
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

            <MySubmissions
                list={mineList}
                onResubmit={startResubmit}
                delistArm={delistArm}
                onArmDelist={setDelistArm}
                onConfirmDelist={(pkgPath) => delist.mutate(pkgPath)}
                delisting={delist.isPending}
            />
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

const STATUS_LABEL: Record<string, string> = {
    pending: "Pending review",
    live: "Live",
    rejected: "Rejected",
    delisted: "Delisted",
}

/** B5 — the caller's own listings: status at a glance, curator reject reasons, free resubmit, delist. */
function MySubmissions({ list, onResubmit, delistArm, onArmDelist, onConfirmDelist, delisting }: {
    list: AppListing[] | undefined
    onResubmit: (l: AppListing) => void
    delistArm: string | null
    onArmDelist: (pkgPath: string | null) => void
    onConfirmDelist: (pkgPath: string) => void
    delisting: boolean
}) {
    if (!list || list.length === 0) return null
    return (
        <section className="appstore__section appsubmit__mine" data-testid="appsubmit-mine">
            <h2 className="appstore__section-title">My submissions</h2>
            <ul className="appsubmit__minelist">
                {list.map((l) => (
                    <li key={l.pkgPath} className="appsubmit__mineitem">
                        <div className="appsubmit__minehead">
                            <span className="appsubmit__minename">{l.name}</span>
                            <span className={`appsubmit__status appsubmit__status--${l.status}`}>
                                {STATUS_LABEL[l.status] ?? l.status}
                            </span>
                        </div>
                        <code className="apppath">{l.pkgPath}</code>
                        {l.status === "rejected" && (
                            <p className="appsubmit__reject">
                                Not approved{l.rejectReason ? <>: {l.rejectReason}</> : "."}
                            </p>
                        )}
                        {(l.status === "rejected" || l.status === "pending") && (
                            <button type="button" className="appbtn appbtn--ghost appsubmit__resubmit"
                                onClick={() => onResubmit(l)}>
                                {l.status === "rejected" ? "Fix & resubmit (free)" : "Edit listing"}
                            </button>
                        )}
                        {l.status === "live" && (
                            <p className="appsubmit__hint">
                                Live listings are locked for edits — ask a curator to update a verified app.
                            </p>
                        )}
                        {l.status !== "delisted" && (delistArm === l.pkgPath ? (
                            <div className="appsubmit__delistconfirm" role="alert" data-testid="delist-confirm">
                                <p>
                                    Delisting is one-way for you: only a curator can restore it, and the
                                    package path stays taken. Remove “{l.name}” from the store?
                                </p>
                                <button type="button" className="appbtn appbtn--danger" disabled={delisting}
                                    onClick={() => onConfirmDelist(l.pkgPath)}>
                                    {delisting ? "Delisting…" : "Yes, delist"}
                                </button>
                                <button type="button" className="appbtn appbtn--ghost" disabled={delisting}
                                    onClick={() => onArmDelist(null)}>
                                    Keep it
                                </button>
                            </div>
                        ) : (
                            <button type="button" className="appbtn appbtn--ghost appsubmit__delist"
                                onClick={() => onArmDelist(l.pkgPath)}>
                                Delist
                            </button>
                        ))}
                    </li>
                ))}
            </ul>
        </section>
    )
}
