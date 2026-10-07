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
import { setDeletion, useDeletion, type DeleteStep } from "./deletion"
import { PrivacyLink } from "./EarlyAccess"
import { useAccountData } from "./useAccountData"

const STEP_FAILED: Record<DeleteStep, string> = {
    memba: "Memba could not delete your data, so nothing was deleted.",
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
    const [asking, setAsking] = useState(false)
    const [exportError, setExportError] = useState("")
    const client = useQueryClient()
    const { account, row, topics, setTopic, token } = useAccountData()
    const deletion = useDeletion()
    if (!ACCOUNT_ENABLED || !account.available) return null
    const privacy = <PrivacyLink />
    // This person's deletion (shared with every window, kept for the session), or the one just finished.
    const deleting = deletion && (deletion.userId === account.user?.id || (deletion.step === "done" && !account.user)) ? deletion : null

    const runDelete = async (from: DeleteStep) => {
        const userId = account.user?.id
        if (!userId) return
        let step: DeleteStep = from
        setDeletion({ userId, step, running: true })
        // From here nothing reads the account again, in any window, until the sign-in account is gone.
        await client.cancelQueries({ queryKey: ["account"] })
        client.removeQueries({ queryKey: ["account"] })
        try {
            const t = await token()
            if (step === "memba") { await accountApi.remove(t); step = "alerts"; setDeletion({ userId, step, running: true }) }
            if (step === "alerts") {
                if (!await deleteMonitoringUser(t)) throw new Error("alerts")
                step = "identity"
                setDeletion({ userId, step, running: true })
            }
            await account.deleteUser()
            setDeletion({ userId, step: "done", running: false })
        } catch {
            setDeletion({ userId, step, running: false })
        }
    }

    if (deleting?.step === "done") {
        return <div className="os-set-card"><h3>Memba account</h3><p role="status">Your account is deleted. Your wallet and everything on chain are not affected.</p></div>
    }
    if (deleting) {
        return <div className="os-set-card"><h3>Deleting your account</h3>
            {deleting.running ? <p role="status">Deleting… keep this window open.</p> : <>
                <p className="os-note os-err" role="alert">{STEP_FAILED[deleting.step]}</p>
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
        {row.isError && <p className="os-note os-err" role="alert">{row.error.message}</p>}
        {r && <p>{r.email
            ? <>Email: <span className="os-mono">{r.email}</span>{r.emailUndeliverable ? " · this address does not receive mail; change it in your sign-in account" : " · verified"}</>
            : "No verified email yet: verify one in your sign-in account to receive email."}</p>}
        <div className="os-row">
            <button type="button" className="os-btn os-quiet" onClick={() => { void account.signOut() }}>Sign out</button>
            <button type="button" className="os-btn os-quiet" onClick={() => { void (async () => {
                setExportError("")
                try {
                    const data = await accountApi.exportData(await token())
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
        {asking ? <>
            <p>This deletes what Memba stores for you (your email and its consent history), your validator alerts, and your sign-in account. It cannot be undone. Your wallet and everything on chain are not affected.</p>
            <div className="os-row">
                <button type="button" className="os-btn" onClick={() => { void runDelete("memba") }}>Delete permanently</button>
                <button type="button" className="os-btn os-quiet" onClick={() => setAsking(false)}>Cancel</button>
            </div>
        </> : <button type="button" className="os-btn os-quiet" onClick={() => setAsking(true)}>Delete my account…</button>}
        <p className="os-sub">{privacy}</p>
    </div>
}
