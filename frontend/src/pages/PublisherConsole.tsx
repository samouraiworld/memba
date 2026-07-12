/**
 * PublisherConsole — the standalone App Store publisher surface at `/apps/my-submissions`.
 *
 * A first-class, paginated view of the connected wallet's own listings (any status): status at a
 * glance, curator reject reasons, remaining free edits, community flag counts, a link to the live
 * store page, plus the free resubmit and one-way delist actions. Editing happens **in place**: the
 * console loads the listing's FULL on-chain detail (`loadEditForm`) and opens the shared
 * `ListingFields` form right here, so `EditListing` never overwrites a field with a blank and the
 * publisher never leaves the console.
 *
 * Gated exactly like the rest of the publisher surface: `VITE_ENABLE_APPSTORE_SUBMIT`, the v3 realm,
 * and a connected wallet. Read-only for a disconnected visitor beyond the connect prompt.
 *
 * @module pages/PublisherConsole
 */

import { useState } from "react"
import { Link } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useAdena } from "../hooks/useAdena"
import { useAuth } from "../hooks/useAuth"
import { useNetwork } from "../hooks/useNetwork"
import { isAppStoreSubmitEnabled } from "../lib/config"
import { isAppStoreV3, fetchByPublisher, type AppListing } from "../lib/appStore"
import {
    loadEditForm, buildDelistAppMsg, buildEditListingMsg, validateSubmission, type AppSubmission,
} from "../lib/appStoreSubmit"
import { ListingFields } from "../components/appstore/ListingFields"
import { PublisherListings } from "../components/appstore/PublisherListings"
import "./appstore.css"

const PAGE_SIZE = 20

export function PublisherConsole() {
    const { networkKey } = useNetwork()
    const { connected, address, connect } = useAdena()
    const auth = useAuth()
    const qc = useQueryClient()
    const [page, setPage] = useState(0)
    const [editLoading, setEditLoading] = useState<string | null>(null)
    const [editError, setEditError] = useState<string | null>(null)
    const [editForm, setEditForm] = useState<AppSubmission | null>(null)
    const [txError, setTxError] = useState<string | null>(null)
    const [delistArm, setDelistArm] = useState<string | null>(null)
    const [delistError, setDelistError] = useState<string | null>(null)

    const submitOpen = isAppStoreSubmitEnabled()
    const v3 = isAppStoreV3()

    const queryKey = ["appStore", "mine", address, page]
    const { data: listings, isLoading } = useQuery({
        queryKey,
        queryFn: () => fetchByPublisher(address, page * PAGE_SIZE, PAGE_SIZE),
        enabled: submitOpen && v3 && connected && !!address,
        staleTime: 30_000,
        retry: 1,
    })

    const delist = useMutation({
        mutationFn: async (pkgPath: string) => {
            const { doContractBroadcast } = await import("../lib/grc20")
            return doContractBroadcast([buildDelistAppMsg(address, pkgPath)], "Delist app")
        },
        onSuccess: (_res, pkgPath) => {
            // Optimistic flip — the chain read lags the broadcast, so don't invalidate "mine" (a
            // refetch would resurrect the old status); the next natural refetch reconciles.
            qc.setQueryData<AppListing[]>(queryKey, (prev) =>
                (prev ?? []).map((l) => (l.pkgPath === pkgPath ? { ...l, status: "delisted" } : l)))
            void qc.invalidateQueries({ queryKey: ["appStore", "pending"] })
            setDelistArm(null)
            setDelistError(null)
        },
        onError: (e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e)
            setDelistError(/denied|rejected by user|cancel/i.test(msg)
                ? null
                : "The delist transaction didn't go through — please try again.")
        },
    })

    // EditListing — free resubmit of the edited listing. Optimistically flip the row back to pending
    // (with the edited fields) and close the inline form; the next refetch reconciles with the chain.
    const resubmit = useMutation({
        mutationFn: async (form: AppSubmission) => {
            const { doContractBroadcast } = await import("../lib/grc20")
            return doContractBroadcast([buildEditListingMsg(address, form)], "Resubmit app")
        },
        onSuccess: (_res, form) => {
            qc.setQueryData<AppListing[]>(queryKey, (prev) =>
                (prev ?? []).map((l) => (l.pkgPath === form.pkgPath
                    ? {
                        ...l, status: "pending", name: form.name, tagline: form.tagline,
                        category: form.category, iconCID: form.iconCID, appURL: form.appURL,
                        descr: form.descr, rejectReason: undefined,
                    }
                    : l)))
            void qc.invalidateQueries({ queryKey: ["appStore", "pending"] })
            setEditForm(null)
            setTxError(null)
        },
        onError: (e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e)
            setTxError(/denied|rejected by user|cancel/i.test(msg)
                ? null
                : "The transaction didn't go through — please try again.")
        },
    })

    // Load the listing's FULL detail and open the inline edit form seeded from it. The list window
    // omits descr + screenshots and EditListing overwrites every field, so seeding from full detail
    // is the only thing that stops a resubmit blanking them. Abort on a failed read — never open a
    // form that would wipe the fields (fail-closed, like the fee).
    const startEdit = async (l: AppListing) => {
        setEditLoading(l.pkgPath)
        setEditError(null)
        const form = await loadEditForm(l.pkgPath)
        setEditLoading(null)
        if (!form) {
            setEditError("Couldn't load this listing's saved details — please try again.")
            return
        }
        setTxError(null)
        setEditForm(form)
    }

    // Adapt the nullable editForm state to ListingFields' non-null setter (edit form is open here).
    const setEditFormFields: React.Dispatch<React.SetStateAction<AppSubmission>> = (update) => {
        setEditForm((prev) => {
            if (!prev) return prev
            return typeof update === "function" ? (update as (f: AppSubmission) => AppSubmission)(prev) : update
        })
    }

    if (!submitOpen) {
        return (
            <Shell networkKey={networkKey}>
                <div className="appstore__notice" data-testid="console-gated">
                    <p className="appstore__notice-title">Publisher console isn't open yet</p>
                    <p className="appstore__muted">
                        Managing your own listings goes live with self-service submissions. Check back soon.
                    </p>
                </div>
            </Shell>
        )
    }
    if (!v3) {
        return (
            <Shell networkKey={networkKey}>
                <div className="appstore__notice" data-testid="console-v2">
                    <p className="appstore__notice-title">The console needs the v3 App Store realm</p>
                    <p className="appstore__muted">This network is still on the previous realm. Check back after the migration.</p>
                </div>
            </Shell>
        )
    }
    if (!connected) {
        return (
            <Shell networkKey={networkKey}>
                <div className="appstore__notice">
                    <p className="appstore__notice-title">Connect your wallet to manage your listings</p>
                    <p className="appstore__muted">Your address is the publisher of the apps you've listed.</p>
                    <button type="button" className="appbtn appbtn--primary" onClick={() => void connect()}>
                        Connect wallet
                    </button>
                </div>
            </Shell>
        )
    }

    const items = listings ?? []
    const hasNext = items.length === PAGE_SIZE
    const editErrors = editForm ? validateSubmission(editForm) : {}
    const canResubmit = !!editForm && editForm.pkgPath !== "" && editForm.name !== ""
        && Object.keys(editErrors).length === 0 && !resubmit.isPending

    return (
        <Shell networkKey={networkKey}>
            <header className="appstore__masthead appsubmit__masthead">
                <p className="appstore__eyebrow">Publisher console</p>
                <h1 className="appstore__headline">My submissions</h1>
                <p className="appstore__lede">
                    Every app you've listed, across all statuses. Fix a rejected listing, edit a pending one, or
                    remove one from the store. <Link to={`/${networkKey}/apps/submit`}>Submit a new app →</Link>
                </p>
            </header>

            {editError && <p className="appsubmit__txerror" role="alert">{editError}</p>}

            {editForm ? (
                <form
                    className="appsubmit__form"
                    data-testid="console-editform"
                    onSubmit={(e) => { e.preventDefault(); if (canResubmit) resubmit.mutate(editForm) }}
                >
                    <div className="appsubmit__editnote" role="note">
                        Fixing <code className="apppath">{editForm.pkgPath}</code> — resubmitting is free and
                        sends it back to review.{" "}
                        <button type="button" className="appsubmit__linkbtn"
                            onClick={() => { setEditForm(null); setTxError(null) }}>
                            Cancel
                        </button>
                    </div>
                    <ListingFields
                        form={editForm} setForm={setEditFormFields} errors={editErrors}
                        authed={auth.isAuthenticated} pkgPathDisabled
                    />
                    {txError && <p className="appsubmit__txerror" role="alert">{txError}</p>}
                    <button type="submit" className="appbtn appbtn--primary appsubmit__submit"
                        data-testid="console-resubmit" disabled={!canResubmit}>
                        {resubmit.isPending ? "Waiting for wallet…" : "Resubmit for review (free)"}
                    </button>
                </form>
            ) : items.length === 0 ? (
                isLoading ? (
                    <p className="appstore__muted" data-testid="console-loading">Loading your submissions…</p>
                ) : (
                    <div className="appstore__notice" data-testid="console-empty">
                        <p className="appstore__notice-title">You haven't listed any apps yet</p>
                        <p className="appstore__muted">
                            List a gno.land realm in the App Store and it'll show up here.{" "}
                            <Link to={`/${networkKey}/apps/submit`}>Submit your first app →</Link>
                        </p>
                    </div>
                )
            ) : (
                <section className="appstore__section appsubmit__mine" data-testid="console-list">
                    <PublisherListings
                        list={items}
                        networkKey={networkKey}
                        onResubmit={(l) => { void startEdit(l) }}
                        editLoading={editLoading}
                        delistArm={delistArm}
                        delistError={delistError}
                        onArmDelist={(p) => { setDelistArm(p); setDelistError(null) }}
                        onConfirmDelist={(pkgPath) => delist.mutate(pkgPath)}
                        delisting={delist.isPending}
                    />
                    {(page > 0 || hasNext) && (
                        <div className="appsubmit__pager" data-testid="console-pager">
                            <button type="button" className="appbtn appbtn--ghost" disabled={page === 0}
                                onClick={() => setPage((p) => Math.max(0, p - 1))}>
                                ← Prev
                            </button>
                            <span className="appsubmit__pagenum">Page {page + 1}</span>
                            <button type="button" className="appbtn appbtn--ghost" disabled={!hasNext}
                                onClick={() => setPage((p) => p + 1)}>
                                Next →
                            </button>
                        </div>
                    )}
                </section>
            )}
        </Shell>
    )
}

function Shell({ networkKey, children }: { networkKey: string; children: React.ReactNode }) {
    return (
        <div className="appstore appsubmit" data-testid="console-root">
            <Link className="appstore__back" to={`/${networkKey}/apps`}>← All apps</Link>
            {children}
        </div>
    )
}
