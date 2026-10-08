/**
 * "Email me when it opens", where a person meets an app that is not open
 * yet. Signing in is asked here, at the step that needs it, never before.
 *
 * @module os/account/EarlyAccess
 */
import { Link } from "react-router-dom"
import { ACCOUNT_ENABLED } from "../../lib/config"
import { EARLY_ACCESS_APPS, type EarlyAccessApp } from "../../lib/accountApi"
import { useAccountData } from "./useAccountData"

/** The privacy page (Settings → Privacy); a link opens its window on top. */
export const PrivacyLink = () => <Link className="os-link" to="/os/privacy">Privacy</Link>

export function EarlyAccess({ app }: { app: EarlyAccessApp }) {
    const { account, topics, setTopic } = useAccountData()
    if (!ACCOUNT_ENABLED || !account.available) return null
    const name = EARLY_ACCESS_APPS[app]
    const privacy = <PrivacyLink />
    let body
    if (account.status === "failed") body = <p className="os-sub">Early access needs sign-in, which is unavailable right now.</p>
    else if (!account.user) {
        body = <>
            <p>Get an email when {name} opens.</p>
            <button type="button" className="os-btn os-quiet" onClick={account.openSignIn}>Sign in for early access</button>
            <p className="os-sub">An optional Memba account, separate from your wallet. {privacy}</p>
        </>
    } else {
        const early = topics.data?.find((t) => t.topic === "early_access")
        const scope = early && early.state !== "off" ? (early.scope ?? "").split(",").filter(Boolean) : []
        if (scope.includes(app) && early?.state === "on") body = <p>You will get an email when {name} opens.</p>
        else if (scope.includes(app)) body = <p>Check your inbox: confirm the email Memba sent you.</p>
        else if (topics.data) {
            body = <>
                <p>Get an email when {name} opens.</p>
                <button type="button" className="os-btn os-quiet" disabled={setTopic.isPending}
                    onClick={() => setTopic.mutate({ topic: "early_access", on: true, source: `early-access:${app}`, scope: [...new Set([...scope, app])].join(",") })}>
                    {setTopic.isPending ? "Sending…" : "Email me when it opens"}
                </button>
                {setTopic.error && <p className="os-note os-err" role="alert">{setTopic.error.message}</p>}
                <p className="os-sub">We send a confirmation email first. {privacy}</p>
            </>
        }
    }
    return body ? <div className="os-note os-early-access" role="group" aria-label={`Early access: ${name}`}>{body}</div> : null
}
