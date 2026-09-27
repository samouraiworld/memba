/**
 * The Multisig app and a multisig window (mockup v4 multisig, msigBody): your
 * multisigs and invitations, then one account with its members, balance and
 * transactions with signature dots. Creating, importing, proposing, signing
 * and broadcasting open Memba's reviewed pages inside the window: the native
 * wizards follow the multisig signing-path review (D20).
 *
 * @module os/multisig/MultisigWindows
 */
import { useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { api } from "../../lib/api"
import { GNO_BECH32_PREFIX, GNO_CHAIN_ID } from "../../lib/config"
import { parseMsgs } from "../../lib/parseMsgs"
import { useBalance } from "../../hooks/useBalance"
import { StatusBadge } from "../../components/ui/StatusBadge"
import { getMultisigStatus } from "../../components/ui/txStatus"
import { ENABLE_NATIVE_GNO_MULTISIG } from "../../lib/config"
import { isNativeMultisig } from "../../lib/nativeMultisig"
import { revealInvisibleFormatting } from "../../lib/dao/v2Text"
import type { Multisig, Transaction } from "../../gen/memba/v1/memba_pb"
import { shortAddr } from "../shell/format"
import { AppTile } from "../shell/icons"
import type { OsSession } from "../shell/useOsSession"
import { specForTarget, type WindowSpec } from "../shell/windows"
import { formatUgnot } from "../wallet/send"
import { useMultisigDetail, useMyMultisigs } from "./useOsMultisig"

function Gate({ session, text }: { session: OsSession; text: string }) {
    return (
        <div className="os-holding">
            <AppTile app="multisig" size={44} />
            <div className="os-holding-title">Multisig</div>
            <p className="os-sub">{text}</p>
            <button type="button" className="os-btn" onClick={session.openConnect}>Connect</button>
        </div>
    )
}

function Loading({ what }: { what: string }) {
    return <div className="os-row" role="status"><span className="os-spin" aria-hidden="true" /><span className="os-sub">Loading {what}…</span></div>
}

const page = (section: string): WindowSpec => specForTarget({ kind: "app", app: "multisig", section })!
const accountSpec = (address: string): WindowSpec => specForTarget({ kind: "multisig", address })!

export function MultisigApp({ session, open }: { session: OsSession; open: (spec: WindowSpec) => void }) {
    const list = useMyMultisigs(session.layout.auth)
    const queryClient = useQueryClient()
    const [joining, setJoining] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    if (session.status !== "member") return <Gate session={session} text="Connect a wallet to see the multisigs you sign for." />

    const join = async (ms: Multisig) => {
        const token = session.layout.auth.token
        if (!token) return
        if (!ms.pubkeyJson) { setError(`Cannot add ${revealInvisibleFormatting(ms.name || ms.address)}: its public-key configuration is unavailable.`); return }
        setJoining(ms.address)
        setError(null)
        try {
            await api.createOrJoinMultisig({ authToken: token, chainId: ms.chainId || GNO_CHAIN_ID, multisigPubkeyJson: ms.pubkeyJson, expectedMultisigAddress: ms.address, name: ms.name || "", bech32Prefix: GNO_BECH32_PREFIX })
            await queryClient.invalidateQueries({ queryKey: ["multisig"] })
        } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't join this multisig.")
        } finally {
            setJoining(null)
        }
    }

    const all = list.data ?? []
    const joined = all.filter((m) => m.joined)
    const invited = all.filter((m) => !m.joined)
    const row = (m: Multisig, action?: ReactNode) => (
        <li key={m.address} className="os-row os-nowrap">
            <button type="button" className="os-it os-click os-grow" onClick={() => open(accountSpec(m.address))}>
                <span className="os-av os-av-lg" aria-hidden="true">{m.threshold}/{m.membersCount}</span>
                <span className="os-grow"><b>{revealInvisibleFormatting(m.name || "Unnamed")}</b><span className="os-sub os-block os-mono">{shortAddr(m.address)} · Requires {m.threshold} of {m.membersCount} members</span></span>
            </button>
            {action}
        </li>
    )
    return (
        <div className="os-stack">
            <div className="os-row">
                <button type="button" className="os-btn" disabled={!ENABLE_NATIVE_GNO_MULTISIG} onClick={() => open(page("create"))}>New multisig</button>
                <button type="button" className="os-btn os-quiet" onClick={() => open(page("import"))}>Import</button>
            </div>
            {!ENABLE_NATIVE_GNO_MULTISIG && <p className="os-sub" role="status">Native multisig registration is on hold pending release approval. Existing accounts can still be imported for read-only history.</p>}
            {list.isPending ? <Loading what="your multisigs" /> : list.isError ? (
                <p className="os-note os-err" role="alert">Couldn't load your multisigs. <button type="button" className="os-btn os-quiet os-inline" onClick={() => void list.refetch()}>Try again</button></p>
            ) : (
                <>
                    <section>
                        <h3 className="os-h">Your multisigs</h3>
                        {joined.length ? <ul className="os-list">{joined.map((m) => row(m))}</ul> : <p className="os-sub">None yet. Create one, or import one by address.</p>}
                    </section>
                    {all.length === 50 && <p className="os-sub" role="status">Showing the newest 50 accounts. Older accounts may not appear here.</p>}
                    {invited.length > 0 && (
                        <section>
                            <h3 className="os-h">Accounts shared with you</h3>
                            <ul className="os-list">{invited.map((m) => row(m, (
                                <button type="button" className="os-btn os-quiet" aria-label={`Add ${revealInvisibleFormatting(m.name || m.address)} to my Memba accounts`} disabled={joining !== null || !m.pubkeyJson} onClick={() => { void join(m) }}>{joining === m.address ? "Adding…" : "Add account"}</button>
                            )))}</ul>
                        </section>
                    )}
                </>
            )}
            {error && <p className="os-note os-err" role="alert">{error}</p>}
        </div>
    )
}

function txTitle(tx: Transaction): { title: string; detail: string } {
    const [first, ...rest] = parseMsgs(tx.msgsJson)
    const detail = first?.fields.map((f) => `${f.key} ${f.value}`).join(" · ") ?? ""
    return { title: `${first?.label ?? "Transaction"}${rest.length ? ` + ${rest.length} more` : ""}`, detail: tx.memo ? `${detail} · “${tx.memo}”` : detail }
}

export function MultisigWindow({ address, session, open }: { address: string; session: OsSession; open: (spec: WindowSpec) => void }) {
    const detail = useMultisigDetail(session.layout.auth, address)
    const balance = useBalance(address)
    const [copied, setCopied] = useState(false)
    if (session.status !== "member") return <Gate session={session} text="Only members of a multisig can see and sign its transactions." />
    if (detail.isPending) return <Loading what="this multisig" />
    if (detail.isError) return <p className="os-note os-err" role="alert">Couldn't load this multisig. <button type="button" className="os-btn os-quiet os-inline" onClick={() => void detail.refetch()}>Try again</button></p>
    if (!detail.data.multisig) return <p className="os-note os-err" role="alert">This multisig is not registered in Memba for your account. <button type="button" className="os-btn os-quiet os-inline" onClick={() => open(page("import"))}>Import it</button></p>
    const m = detail.data.multisig
    const nativeEnabled = ENABLE_NATIVE_GNO_MULTISIG && isNativeMultisig(m.pubkeyJson)
    const me = session.address
    const txs = [...detail.data.pending, ...detail.data.executed].sort((a, b) => b.id - a.id)
    const copy = async () => {
        try { await navigator.clipboard.writeText(address); setCopied(true) } catch { /* the address stays visible */ }
    }
    return (
        <div className="os-stack os-msig">
            <div className="os-row os-nowrap os-msig-head">
                <span className="os-av os-av-lg" aria-hidden="true">{m.threshold}/{m.membersCount}</span>
                <div className="os-grow">
                    <b>{revealInvisibleFormatting(m.name || "Unnamed multisig")}</b>
                    <div className="os-sub">Requires {m.threshold} of {m.membersCount} members · <span className="os-mono">{shortAddr(address)}</span></div>
                </div>
                <div className="os-right"><div className="os-big">{balance.error ? "Balance unavailable" : balance.rawUgnot === undefined ? balance.balance : formatUgnot(balance.rawUgnot)}</div>{balance.error && <button type="button" className="os-btn os-quiet" onClick={() => void balance.refetch()}>Retry balance</button>}</div>
            </div>
            <div className="os-chipset" aria-label="Members">{m.usersAddresses.map((a) => <span key={a} className="os-pill os-mono" title={a}>{a === me ? "You" : shortAddr(a)}</span>)}</div>
            <div className="os-row">
                <button type="button" className="os-btn" disabled={!nativeEnabled} onClick={() => open(page(`${address}/propose`))}>Propose transaction</button>
                <button type="button" className="os-btn os-quiet" onClick={() => { void copy() }}>{copied ? "Address copied" : `Copy ${GNO_CHAIN_ID} deposit address`}</button>
            </div>
            {!nativeEnabled && <p className="os-sub" role="status">{isNativeMultisig(m.pubkeyJson) ? "Native signing and broadcasting are on hold pending release approval." : "Legacy multisig records are read-only history. They cannot be executed on Gno from Memba."}</p>}
            <section>
                <div className="os-row os-between"><h3 className="os-h">Transactions</h3><button type="button" className="os-btn os-quiet" onClick={() => void detail.refetch()}>Refresh</button></div>
                {(detail.data.pendingError || detail.data.executedError) && <p className="os-note os-err" role="alert">{detail.data.pendingError && detail.data.executedError ? "Pending and completed transactions couldn't be loaded." : detail.data.pendingError ? "Pending transactions couldn't be loaded." : "Completed transactions couldn't be loaded."} Try Refresh.</p>}
                {(detail.data.pending.length === 50 || detail.data.executed.length === 50) && <p className="os-sub" role="status">Showing up to 50 pending and 50 completed transactions. Older records may not appear here.</p>}
                {txs.length === 0 ? (detail.data.pendingError || detail.data.executedError ? null : <p className="os-sub">No proposals yet. When available, propose a transaction for members to review. Fund this wallet before any transfer is broadcast.</p>) : (
                    <ul className="os-list">{txs.map((tx) => {
                        const { title, detail: what } = txTitle(tx)
                        const signed = new Set(tx.signatures.map((s) => s.userAddress))
                        const verified = new Set(tx.signatures.filter((s) => s.verified).map((s) => s.userAddress))
                        return (
                            <li key={tx.id} className="os-it os-top">
                                <div className="os-grow">
                                    <b>#{tx.id} {title}</b>
                                    <div className="os-sub os-break">{what}</div>
                                    <div className="os-row os-tight">
                                        <span className="os-sigdots" aria-label={`${signed.size} submitted, ${verified.size} verified, threshold ${tx.threshold}`}>
                                            {m.usersAddresses.map((a) => <span key={a} className={verified.has(a) ? "os-on" : undefined} title={`${a}${signed.has(a) ? verified.has(a) ? ": verified" : ": submitted, unverified" : ": not signed"}`}>{a.slice(2, 3).toUpperCase()}</span>)}
                                        </span>
                                        <span className="os-sub">{signed.size} submitted · {verified.size} verified · threshold {tx.threshold}</span>
                                    </div>
                                </div>
                                <div className="os-stack os-tight os-right">
                                    <StatusBadge status={getMultisigStatus(tx)} sigCount={signed.size} threshold={tx.threshold} />
                                    <button type="button" className="os-btn os-quiet" aria-label={`View transaction #${tx.id}: ${title}`} onClick={() => open(specForTarget({ kind: "app", app: "wallet", section: `tx/${tx.id}` })!)}>View details</button>
                                </div>
                            </li>
                        )
                    })}</ul>
                )}
            </section>
        </div>
    )
}
