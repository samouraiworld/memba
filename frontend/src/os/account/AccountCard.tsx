/**
 * Settings → Account: the optional Memba account. Sign in, the address Memba
 * uses, the email topics (each confirmed by email first), the data download,
 * and deletion, which goes step by step: Memba's data (and the email
 * provider's contacts), the validator alerts at gnomonitoring, then the
 * sign-in account itself. Memba's data must go first, and nothing reads the
 * account after it (a read would create it again).
 *
 * @module os/account/AccountCard
 */
import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { accountApi, EARLY_ACCESS_APPS, TOPICS, type EarlyAccessApp, type TopicState } from "../../lib/accountApi"
import { ACCOUNT_ENABLED } from "../../lib/config"
import { deleteMonitoringUser } from "../../lib/monitoringAuth"
import { setDeletion, useDeletion, getDeletion, beginDeletion, type DeleteStep } from "./deletion"
import { PrivacyLink } from "./EarlyAccess"
import { requireDeletionCoordination, withDeletionLock } from "../../account/operations"
import { useAccountData } from "./useAccountData"

const STEP_FAILED: Record<DeleteStep, string> = {
    memba: "Account deletion is incomplete. Try again to confirm removal of your Memba data and finish the remaining steps.",
    alerts: "Your Memba data is deleted, but your validator alerts could not be deleted yet.",
    identity: "Your Memba data and validator alerts are deleted, but your sign-in account could not be deleted yet.",
}

function Topic({ state, busy, onSet }: { state: TopicState; busy: boolean; onSet: (on: boolean, scope?: string) => void }) {
    const meta = TOPICS.find((t) => t.topic === state.topic)!
    const scope = (state.scope ?? "").split(",").filter(Boolean)
    const [apps, setApps] = useState<string[]>(scope)
    const label = state.state === "on" ? "On" : state.state === "pending" ? "Check your inbox to confirm" : "Off"
    return <li className="os-set-topic">
        <div><b>{meta.name}</b> <span className="os-sub">· {label}</span><p className="os-sub">{meta.text}</p></div>
        {state.topic === "early_access" && <fieldset className="os-set-choice" aria-label="Apps">
            {(Object.keys(EARLY_ACCESS_APPS) as EarlyAccessApp[]).map((app) => <label key={app} className="os-set-toggle">
                <input type="checkbox" checked={apps.includes(app)} onChange={(e) => setApps(e.target.checked ? [...apps, app] : apps.filter((a) => a !== app))} />{EARLY_ACCESS_APPS[app]}
            </label>)}
        </fieldset>}
        <div className="os-row">
            {(state.state === "off" || (state.topic === "early_access" && apps.join(",") !== scope.join(","))) &&
                <button type="button" className="os-btn os-quiet" disabled={busy || (state.topic === "early_access" && apps.length === 0)} onClick={() => onSet(true, apps.join(","))}>Email me</button>}
            {state.state !== "off" && <button type="button" className="os-btn os-quiet" disabled={busy} onClick={() => onSet(false)}>Stop</button>}
        </div>
    </li>
}

export function AccountCard() {
    const [asking, setAsking] = useState<string | null>(null)
    const [exportError, setExportError] = useState("")
    const [deleteError, setDeleteError] = useState("")
    const client = useQueryClient()
    const { account, row, topics, setTopic, request } = useAccountData()
    const deletion = useDeletion(account.user?.id)
    if (!ACCOUNT_ENABLED || !account.available) return null
    const privacy = <PrivacyLink />
    // This subject's durable deletion, shared across same-origin tabs/windows.
    const deleting = deletion && (deletion.userId === account.user?.id || (deletion.step === "done" && !account.user)) ? deletion : null

    const runDelete = async (from: DeleteStep) => {
        const userId = account.user?.id
        if (!userId) return
        let step: DeleteStep = from
        setDeleteError("")
        try {
            account.assertCurrentUser(userId)
            requireDeletionCoordination()
            const prior = getDeletion(userId)
            if (prior?.step === "done") return
            step = prior?.step ?? from
            beginDeletion(userId)
            await client.cancelQueries({ queryKey: ["account", userId] })
            client.removeQueries({ queryKey: ["account", userId] })
            await withDeletionLock(userId, async () => {
                const saved = getDeletion(userId)
                if (saved?.step === "done") return
                step = saved?.step ?? step
                try {
                    setDeletion({ userId, step, running: true })
                    const token = async () => {
                        const t = await account.getToken(userId)
                        if (!t) throw new Error("Your sign-in changed. Return to the account whose deletion you confirmed.")
                        return t
                    }
                    if (step === "memba") { await accountApi.remove(await token()); step = "alerts"; setDeletion({ userId, step, running: true }) }
                    if (step === "alerts") {
                        if (!await deleteMonitoringUser(await token())) throw new Error("Validator alerts could not be deleted. Try again.")
                        step = "identity"
                        setDeletion({ userId, step, running: true })
                    }
                    await token()
                    await account.deleteUser(userId)
                    setDeletion({ userId, step: "done", running: false })
                } catch (err) {
                    setDeletion({ userId, step, running: false })
                    throw err
                }
            })
        } catch (err) {
            setDeleteError(err instanceof Error ? err.message : "Account deletion could not finish.")
        }
    }

    if (deleting?.step === "done") {
        return <div className="os-set-card"><h3>Memba account</h3><p role="status">Your account is deleted. Your wallet and everything on chain are not affected.</p></div>
    }
    if (deleting) {
        return <div className="os-set-card"><h3>Deleting your account</h3>
            {deleting.running ? <p role="status">Deleting… keep this window open.</p> : <>
                <p className="os-note os-err" role="alert">{STEP_FAILED[deleting.step]} {deleteError}</p>
                <button type="button" className="os-btn" onClick={() => { void runDelete(deleting.step as DeleteStep) }}>Try again</button>
            </>}
        </div>
    }
    if (account.status === "failed") return <div className="os-set-card"><h3>Memba account</h3><p>Sign-in is unavailable right now. Try again later.</p></div>
    if (!account.user) {
        return <div className="os-set-card"><h3>Memba account (optional)</h3>
            <p>An account lets Memba email you what you choose: announcements, the newsletter, early access. It never replaces your wallet, and nothing on chain needs it.</p>
            <button type="button" className="os-btn" disabled={account.status === "loading"} onClick={account.openSignIn}>{account.status === "loading" ? "Loading…" : "Sign in"}</button>
            <p className="os-sub">GitHub, Discord or an email code. {privacy}</p>
        </div>
    }
    const r = row.data
    return <div className="os-set-card"><h3>Memba account</h3>
        {row.isError && <p className="os-note os-err" role="alert">{row.error.message} <button type="button" className="os-btn os-quiet" onClick={() => { void row.refetch() }}>Retry account</button></p>}
        {topics.isError && <p className="os-note os-err" role="alert">{topics.error.message} <button type="button" className="os-btn os-quiet" onClick={() => { void topics.refetch() }}>Retry email topics</button></p>}
        {r && <p>{r.email
            ? <>Email: <span className="os-mono">{r.email}</span>{r.emailUndeliverable ? " · this address does not receive mail; change it in your sign-in account" : " · verified"}</>
            : "No verified email yet: verify one in your sign-in account to receive email."}</p>}
        <div className="os-row">
            <button type="button" className="os-btn os-quiet" onClick={() => { void account.signOut() }}>Sign out</button>
            <button type="button" className="os-btn os-quiet" onClick={() => { void (async () => {
                setExportError("")
                try {
                    const data = await request(t => accountApi.exportData(t))
                    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }))
                    const a = Object.assign(document.createElement("a"), { href: url, download: "memba-account.json" })
                    a.click()
                    URL.revokeObjectURL(url)
                } catch (err) {
                    setExportError(err instanceof Error ? err.message : "Your data could not be downloaded.")
                }
            })() }}>Download my data</button>
        </div>
        {exportError && <p className="os-note os-err" role="alert">Your data could not be downloaded: {exportError}</p>}
        {topics.data && r?.email && !r.emailUndeliverable && <>
            <h4>Email</h4>
            <p className="os-sub">Nothing is sent before you confirm by email. You can stop any of these here at any time.</p>
            <ul className="os-list">{topics.data.map((s) => <Topic key={s.topic} state={s} busy={setTopic.isPending}
                onSet={(on, scope) => setTopic.mutate({ topic: s.topic, on, scope, source: "settings" })} />)}</ul>
            {setTopic.error && <p className="os-note os-err" role="alert">{setTopic.error.message}</p>}
        </>}
        <h4>Delete my account</h4>
        {deleteError && <p role="alert">{deleteError}</p>}
        {asking === account.user.id ? <>
            <p>This deletes your Memba email and consent history, your validator alerts, and your sign-in account. Memba keeps a pseudonymized deletion marker to reject old sign-in tokens. It cannot be undone. Your wallet and everything on chain are not affected.</p>
            <div className="os-row">
                <button type="button" className="os-btn" onClick={() => { void runDelete("memba") }}>Delete permanently</button>
                <button type="button" className="os-btn os-quiet" onClick={() => setAsking(null)}>Cancel</button>
            </div>
        </> : <button type="button" className="os-btn os-quiet" onClick={() => setAsking(account.user!.id)}>Delete my account…</button>}
        <p className="os-sub">{privacy}</p>
    </div>
}
