/**
 * The page a confirmation email links to (/os/confirm?t=…). Opening it
 * changes nothing: a mail scanner may follow the link. The person presses
 * Confirm. No sign-in: the link's token is the proof. The token is read once
 * into memory and taken out of the window's address at once, so it is not in
 * a copied link, the saved desk, or later page views.
 *
 * @module os/account/ConfirmView
 */
import { useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { accountApi, TOPICS } from "../../lib/accountApi"

export function ConfirmView({ query, forget }: { query: string; forget: () => void }) {
    const [token] = useState(() => new URLSearchParams(query).get("t") ?? "")
    const client = useQueryClient()
    const inAddress = new URLSearchParams(query).has("t")
    useEffect(() => { if (inAddress) forget() }, [inAddress, forget])
    const [state, setState] = useState<{ kind: "idle" | "working" } | { kind: "done"; topic: string } | { kind: "error"; message: string }>({ kind: "idle" })
    if (!token) return <div className="os-set-card"><h3>Confirm your email</h3><p>This link is incomplete. Open it again from the email Memba sent you.</p></div>
    const confirm = async () => {
        setState({ kind: "working" })
        try {
            const { topic } = await accountApi.confirm(token)
            setState({ kind: "done", topic: TOPICS.find((t) => t.topic === topic)?.name ?? topic })
            void client.invalidateQueries({ queryKey: ["account"] })
        } catch (err) {
            setState({ kind: "error", message: err instanceof Error ? err.message : "This link could not be confirmed." })
        }
    }
    return <div className="os-set-card">
        <h3>Confirm your email</h3>
        {state.kind === "done"
            ? <p role="status">Confirmed: Memba will email you {state.topic.toLowerCase()}. You can turn it off below, in Account.</p>
            : <>
                <p>Press Confirm to receive the emails you asked Memba for. If you did not ask, close this page: nothing is sent without your confirmation.</p>
                <button type="button" className="os-btn" disabled={state.kind === "working"} onClick={() => { void confirm() }}>{state.kind === "working" ? "Confirming…" : "Confirm"}</button>
                {state.kind === "error" && <p className="os-note os-err" role="alert">{state.message}</p>}
            </>}
    </div>
}
