/**
 * The Multisig app and a Safe window on an EVM network (Base Sepolia before
 * launch). Read-only for now: creating, importing, proposing, signing and
 * executing come in the next steps.
 *
 * Guests see everything a Safe shows the world (owners, threshold, balance,
 * queue, history: all public); a wallet is asked for only where their own
 * data would be (the Safes listing them). What a Safe is comes from the chain,
 * checked from its code (lib/chain/evm/safe/inspect.ts); queue and history from
 * the Safe Transaction Service through Memba's proxy, each queued transaction
 * checked in the browser before it is shown as signed.
 *
 * @module os/multisig/evm/SafeWindows
 */
import { useState, type FormEvent } from "react"
import { EVM_NETWORKS } from "../../../lib/chain/evm/networks"
import { NOT_A_SAFE_TEXT } from "../../../lib/chain/evm/safe/inspect"
import { loadSafeSdk } from "../../../lib/chain/evm/safe/load"
import { parseRecipient, addressGroups } from "../../../lib/chain/evm/safe/recipients"
import type { Hex } from "../../../lib/chain/evm/safe/known"
import { revealInvisibleFormatting } from "../../../lib/dao/v2Text"
import { shortAddr } from "../../shell/format"
import type { OsSession } from "../../shell/useOsSession"
import { specForTarget, type WindowSpec } from "../../shell/windows"
import { ConnectHere, CopyAddressButton, Loading, MemberChips, SigDots, ThresholdAvatar } from "../MultisigParts"
import { API_BASE_URL } from "../../../lib/config"
import { actionErrorText, describeTx, formatEth } from "./describe"
import { TxLinesView } from "./TxLines"
import { useTxLines } from "./lineModel"
import { registerErrorText, safeLabel, useMySafes, useRegisterSafe, useSafeToken } from "./useMySafes"
import { HISTORY_LIMIT, safeNetworkOf, sameNonce, useSafeAwaiting, useSafeBalance, useSafeFacts, useSafeHistory, useSafeQueue, useSafesListing, type QueuedTx, type SafeNetwork } from "./useSafes"

const ABOUT = "A Safe is a shared account on this network: a transaction leaves it only when enough of its owners sign, for example 2 of 3. Owners sign without paying gas; whoever executes the transaction pays it."

const accountSpec = (address: string): WindowSpec => specForTarget({ kind: "multisig", address })!

function explorerTx(networkKey: string, hash: string): string | null {
    const base = Object.hasOwn(EVM_NETWORKS, networkKey) ? EVM_NETWORKS[networkKey].explorerUrl : null
    return base && /^0x[0-9a-fA-F]{64}$/.test(hash) ? `${base}/tx/${hash}` : null
}

function TxServiceError({ what, retry }: { what: string; retry: () => void }) {
    return <p className="os-note os-err" role="alert">Couldn't read {what} from the Safe Transaction Service. <button type="button" className="os-btn os-quiet os-inline" onClick={retry}>Try again</button></p>
}

/** Open any Safe by its address: a guest can look at any Safe. Mixed case must match its checksum. */
function OpenByAddress({ open }: { open: (spec: WindowSpec) => void }) {
    const [draft, setDraft] = useState("")
    const [error, setError] = useState<string | null>(null)
    const submit = async (e: FormEvent) => {
        e.preventDefault()
        let parsed
        try {
            const sdk = await loadSafeSdk()
            parsed = parseRecipient(draft, (a) => sdk.toChecksum(a))
        } catch {
            setError("Couldn't load what checks the address. Try again.")
            return
        }
        if (!parsed.ok) { setError(parsed.error); return }
        setError(null)
        open(accountSpec(parsed.address))
    }
    return (
        <form className="os-stack os-tight" onSubmit={(e) => { void submit(e) }}>
            <div className="os-row">
                <input className="os-in os-mono" aria-label="Safe address" placeholder="0x… Safe address" value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="off" spellCheck={false} aria-invalid={!!error} />
                <button type="submit" className="os-btn os-quiet" disabled={!draft.trim()}>Open</button>
            </div>
            {error && <p className="os-fe" role="alert">{error}</p>}
        </form>
    )
}

export function SafeApp({ session, open }: { session: OsSession; open: (spec: WindowSpec) => void }) {
    const net = safeNetworkOf(session)
    // The connected wallet: Safe data is public, and the wallet is what signs (no Memba sign-in needed).
    const me = session.walletAddress?.toLowerCase() ?? ""
    const listing = useSafesListing(net, me)
    const awaiting = useSafeAwaiting(net, me)
    // Keeping and naming Safes needs a Sign-In with Ethereum session.
    const token = useSafeToken(session)
    const mine = useMySafes(net, token)
    const register = useRegisterSafe(net, token)
    const [addError, setAddError] = useState<string | null>(null)
    const kept = new Set((mine.data ?? []).map((r) => r.address))
    const waiting = (address: string) => (awaiting.counts.get(address) ?? 0) > 0 && <span className="os-sub os-block os-strong">{awaiting.counts.get(address)} waiting for your signature</span>
    const add = async (address: string) => {
        setAddError(null)
        try { await register.mutateAsync({ address, name: "", joined: true }) } catch (err) { setAddError(registerErrorText(err)) }
    }
    return (
        <div className="os-stack">
            <div className="os-row">
                <button type="button" className="os-btn" onClick={() => open(specForTarget({ kind: "app", app: "multisig", section: "create" })!)}>New Safe</button>
                <button type="button" className="os-btn os-quiet" onClick={() => open(specForTarget({ kind: "app", app: "multisig", section: "import" })!)}>Import a Safe</button>
            </div>
            <OpenByAddress open={open} />
            {token && <section>
                <h3 className="os-h">Your Safes</h3>
                {mine.isPending ? <Loading what="your Safes" />
                    : mine.isError ? <p className="os-note os-err" role="alert">Couldn't load your Safes. <button type="button" className="os-btn os-quiet os-inline" onClick={() => void mine.refetch()}>Try again</button></p>
                    : mine.data.length === 0 ? <p className="os-sub">None yet. Import one, or add one that lists you below.</p>
                    : <ul className="os-list">{mine.data.map((r) => {
                        const name = safeLabel(r)
                        return (
                            <li key={r.address} className="os-row os-nowrap">
                                <button type="button" className="os-it os-click os-grow" onClick={() => open(accountSpec(r.address))}>
                                    <span className="os-grow">
                                        <b>{name ? revealInvisibleFormatting(name.name) : "Safe"}</b>{name?.namedBy && <span className="os-sub"> · named by {shortAddr(name.namedBy)}</span>}
                                        <span className="os-sub os-block os-mono os-break">{addressGroups(listing.data?.find((x) => x.address === r.address)?.display ?? r.address).join(" ")}</span>
                                        {waiting(r.address)}
                                    </span>
                                </button>
                            </li>
                        )
                    })}</ul>}
            </section>}
            {!me ? <><p className="os-sub">{ABOUT}</p><ConnectHere resuming={session.status === "resuming"} onConnect={session.openConnect} text="Connect a wallet to see the Safes that list you as an owner." /></>
                : listing.isPending ? <Loading what="the Safes that list you" />
                : listing.isError ? <TxServiceError what="the Safes that list you" retry={() => void listing.refetch()} />
                : (
                    <section>
                        <h3 className="os-h">Safes listing you as an owner</h3>
                        {listing.data.length === 0 ? <><p className="os-sub">{ABOUT}</p><p className="os-sub">No Safe on {session.network.label} lists this address as an owner.</p></> : <>
                            <p className="os-sub">Anyone can create a Safe that lists you as an owner. Open one only if you know it.</p>
                            {!token && <p className="os-sub">Sign in with this wallet to keep Safes in your list and name them. <button type="button" className="os-btn os-quiet os-inline" onClick={session.openConnect}>Sign in</button></p>}
                            <ul className="os-list">{listing.data.filter((s) => !kept.has(s.address)).map((s) => (
                                <li key={s.address} className="os-row os-nowrap">
                                    <button type="button" className="os-it os-click os-grow" onClick={() => open(accountSpec(s.address))}>
                                        <span className="os-grow"><b className="os-mono os-break">{s.display}</b>{waiting(s.address)}</span>
                                    </button>
                                    {token && <button type="button" className="os-btn os-quiet" aria-label={`Add ${s.display} to your Safes`} disabled={register.isPending} onClick={() => { void add(s.address) }}>Add</button>}
                                </li>
                            ))}</ul>
                        </>}
                    </section>
                )}
            {addError && <p className="os-note os-err" role="alert">{addError}</p>}
        </div>
    )
}

/**
 * The Safe's name in Memba and, for its owner signed in with this wallet,
 * renaming, adding it to their list and taking it out. A name is the
 * account's own; another owner's first name shows until they give one.
 */
function SafeNameBar({ session, address, owner }: { session: OsSession; address: Hex; owner: boolean }) {
    const net = safeNetworkOf(session)
    const token = useSafeToken(session)
    const mine = useMySafes(net, token)
    const register = useRegisterSafe(net, token)
    const record = mine.data?.find((r) => r.address === address)
    const label = safeLabel(record)
    const [draft, setDraft] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const save = async (name: string, joined: boolean) => {
        setError(null)
        try { await register.mutateAsync({ address, name, joined }); setDraft(null) } catch (err) { setError(registerErrorText(err)) }
    }
    return (
        <div className="os-stack os-tight">
            {label && <p className="os-sub"><b>{revealInvisibleFormatting(label.name)}</b>{label.namedBy && <> · named by {shortAddr(label.namedBy)}</>}</p>}
            {owner && token && (draft !== null
                ? <form className="os-row" onSubmit={(e) => { e.preventDefault(); void save(draft.trim(), true) }}>
                    <input className="os-in" aria-label="Safe name" value={draft} maxLength={100} onChange={(e) => setDraft(e.target.value)} autoComplete="off" />
                    <button type="submit" className="os-btn" disabled={register.isPending}>Save</button>
                    <button type="button" className="os-btn os-quiet" onClick={() => setDraft(null)}>Cancel</button>
                </form>
                : <div className="os-row">
                    {record?.joined
                        ? <><button type="button" className="os-btn os-quiet" onClick={() => setDraft(record.name)}>Rename</button>
                            <button type="button" className="os-btn os-quiet" disabled={register.isPending} onClick={() => { void save(record.name, false) }}>Remove from my Safes</button></>
                        : <button type="button" className="os-btn os-quiet" disabled={register.isPending} onClick={() => { void save(record?.name ?? "", true) }}>Add to my Safes</button>}
                </div>)}
            {error && <p className="os-note os-err" role="alert">{error}</p>}
        </div>
    )
}

/** The address in full, in groups of four: never only its start and end. */
function FullAddress({ display }: { display: string }) {
    return <div className="os-sub os-mono os-break" aria-label={display}>{addressGroups(display).join(" ")}</div>
}

/**
 * A queued transaction: every call in full (./TxLines.tsx), then Sign or
 * Execute from the connected wallet. Signing is offered to an owner who
 * hasn't signed; executing once it is the Safe's next nonce and enough
 * signatures recover to owners (an owner executor approves by sending).
 * Nothing is offered until every line is drawn, nor for a transaction whose
 * hash doesn't match, that pays a gas refund, or that runs a call Memba won't
 * run; one that changes the Safe, calls an unnamed contract or grants an
 * allowance needs a confirmation first.
 */
function QueueItem({ net, address, tx, safe, me, network, clash, refresh }: { net: SafeNetwork; address: Hex; tx: QueuedTx; safe: { owners: string[]; threshold: number; nonce: bigint }; me: string; network: string; clash: number | undefined; refresh: () => void }) {
    const lines = useTxLines(net, address, safe.owners, tx)
    const [checked, setChecked] = useState(false)
    const [busy, setBusy] = useState<"" | "sign" | "execute">("")
    const [note, setNote] = useState<{ error: boolean; text: string; hash?: string } | null>(null)
    const owner = safe.owners.includes(me)
    // Only a signature recovered to you counts: a listed one that doesn't recover doesn't hide Sign.
    const canSign = !!me && owner && !tx.verified.has(me)
    const executorApproves = owner && !tx.verified.has(me)
    const canExecute = !!me && tx.nonce === safe.nonce && tx.verified.size + (executorApproves ? 1 : 0) >= safe.threshold
    const offered = tx.hashMatches && !tx.blocked && (canSign || canExecute)
    const needsAck = !!lines.data?.some((l) => l.needsAck)
    const act = async (what: "sign" | "execute") => {
        setBusy(what)
        setNote(null)
        let sent: string | undefined
        try {
            const sdk = await loadSafeSdk()
            try {
                if (what === "sign") await sdk.confirmSafeTx(net.key, API_BASE_URL, address, tx.safeTxHash as Hex)
                else await sdk.executeSafeTx(net.key, API_BASE_URL, address, tx.safeTxHash as Hex, (h) => { sent = h; setNote({ error: false, text: "Executing…", hash: h }) })
                setNote({ error: false, text: what === "sign" ? "Signed." : "Executed.", hash: sent })
                refresh()
            } catch (err) {
                const hash = err instanceof sdk.SafeActionError && "hash" in err.reason ? err.reason.hash : sent
                setNote({ error: true, text: err instanceof sdk.SafeActionError ? actionErrorText(err.reason, network, what) : "It didn't go through. Try again.", hash })
            }
        } catch {
            setNote({ error: true, text: "Couldn't load what signs Safe transactions. Try again." })
        } finally {
            setBusy("")
        }
    }
    const link = note?.hash ? explorerTx(net.key, note.hash) : null
    return (
        <li className="os-it os-top">
            <div className="os-grow os-stack os-tight">
                <b>#{tx.nonce.toString()} {describeTx(tx.decoded).title}</b>
                {!tx.hashMatches ? null : lines.isPending ? <Loading what="what this transaction does" />
                    : lines.isError ? <p className="os-note os-err" role="alert">Couldn't read every call of this transaction. <button type="button" className="os-btn os-quiet os-inline" onClick={() => void lines.refetch()}>Try again</button></p>
                    : <TxLinesView lines={lines.data} batch={tx.decoded.kind === "batch"} />}
                {!tx.hashMatches && <p className="os-note os-err" role="alert">This proposal's hash doesn't match its contents. Don't sign it.</p>}
                {tx.hashMatches && tx.blocked && <p className="os-note os-err" role="alert">Memba won't sign or execute this transaction: {tx.blocked}. Don't sign it elsewhere unless every owner agreed to that.</p>}
                {clash && <p className="os-note os-warn">{clash} proposals use nonce {tx.nonce.toString()}: only one of them can execute.</p>}
                {tx.duplicates && <p className="os-note os-warn">The Safe Transaction Service listed {tx.duplicates + 1} entries with this hash: Memba shows only {tx.hashMatches ? "the one whose contents match it" : "one, and none matches it"}.</p>}
                <SigDots members={safe.owners} signed={tx.submitted} verified={tx.verified} threshold={tx.threshold} />
                {offered && lines.data && <>
                    {needsAck && <label className="os-row"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> <span className="os-sub">I checked every line above with the other owners.</span></label>}
                    <div className="os-row">
                        {canSign && <button type="button" className="os-btn" disabled={busy !== "" || (needsAck && !checked)} onClick={() => { void act("sign") }}>{busy === "sign" ? "Sign in your wallet…" : "Sign"}</button>}
                        {canExecute && <button type="button" className={canSign ? "os-btn os-quiet" : "os-btn"} disabled={busy !== "" || (needsAck && !checked)} onClick={() => { void act("execute") }}>{busy === "execute" ? "Confirm in your wallet…" : executorApproves ? "Sign and execute" : "Execute"}</button>}
                    </div>
                    {canExecute && <p className="os-sub">Executing sends a transaction from your wallet, which pays its gas.</p>}
                </>}
                {note && <p className={note.error ? "os-note os-err" : "os-sub"} role={note.error ? "alert" : "status"}>{note.text}{link && <> <a href={link} target="_blank" rel="noreferrer">Transaction</a></>}</p>}
            </div>
            <span className="os-pill">{tx.verified.size >= tx.threshold && tx.hashMatches && !tx.blocked ? "Ready to execute" : `${tx.verified.size} of ${tx.threshold}`}</span>
        </li>
    )
}

export function SafeWindow({ address, session, open }: { address: string; session: OsSession; open: (spec: WindowSpec) => void }) {
    const net = safeNetworkOf(session)
    const canonical = address.toLowerCase() as Hex
    const facts = useSafeFacts(net, canonical)
    const balance = useSafeBalance(net, canonical)
    const inspection = facts.data?.inspection
    const safe = inspection?.kind === "ok" && inspection.value.kind === "safe" ? inspection.value : null
    const queue = useSafeQueue(net, canonical, safe)
    const history = useSafeHistory(net, canonical, !!safe)
    const display = (a: string) => facts.data?.display[a] ?? a
    // The connected wallet: Safe data is public, and the wallet is what signs (no Memba sign-in needed).
    const me = session.walletAddress?.toLowerCase() ?? ""

    const funds = (
        <div className="os-right"><div className="os-big">{balance.isPending ? "…" : balance.data?.kind === "ok" ? formatEth(balance.data.value) : "Balance unavailable"}</div>
            {(balance.isError || balance.data?.kind === "unavailable") && <button type="button" className="os-btn os-quiet" onClick={() => void balance.refetch()}>Retry balance</button>}</div>
    )
    if (facts.isPending) return <Loading what="what the chain says about this address" />
    if (facts.isError || !inspection) return <p className="os-note os-err" role="alert">Couldn't check this address on {session.network.label}. <button type="button" className="os-btn os-quiet os-inline" onClick={() => void facts.refetch()}>Try again</button></p>
    if (inspection.kind === "unavailable") {
        return (
            <div className="os-stack os-msig">
                <div className="os-row os-nowrap os-msig-head"><div className="os-grow"><b>Account</b><FullAddress display={display(canonical)} /></div></div>
                <p className="os-note os-err" role="alert">Couldn't check this address on {session.network.label}: {inspection.reason}. Nothing is shown until the chain answers. <button type="button" className="os-btn os-quiet os-inline" onClick={() => void facts.refetch()}>Try again</button></p>
            </div>
        )
    }
    if (inspection.value.kind === "not-a-safe") {
        return (
            <div className="os-stack os-msig">
                <div className="os-row os-nowrap os-msig-head"><div className="os-grow"><b>Account</b><FullAddress display={display(canonical)} /></div>{funds}</div>
                <p className="os-sub" role="status">{NOT_A_SAFE_TEXT[inspection.value.reason]}</p>
            </div>
        )
    }

    const s = inspection.value
    const conflicts = queue.data ? sameNonce(queue.data) : new Map<string, number>()
    const label = session.network.label
    return (
        <div className="os-stack os-msig">
            <div className="os-row os-nowrap os-msig-head">
                <ThresholdAvatar threshold={s.threshold} members={s.owners.length} />
                <div className="os-grow">
                    <b>Safe</b><span className="os-sub"> · v{s.version}{s.l2 ? "" : " (non-L2)"} · Requires {s.threshold} of {s.owners.length} owners · nonce {s.nonce.toString()}</span>
                    <FullAddress display={display(canonical)} />
                </div>
                {funds}
            </div>
            {s.warnings.map((w) => (
                <div key={w.code} className={`os-note ${w.severity === "danger" ? "os-err" : "os-warn"}`} role={w.severity === "danger" ? "alert" : "status"}>
                    {w.text}{w.addresses.length > 0 && <div className="os-mono os-break">{w.addresses.map(display).join(", ")}</div>}
                </div>
            ))}
            <SafeNameBar session={session} address={canonical} owner={s.owners.includes(me as Hex)} />
            <MemberChips members={s.owners.map(display)} me={me ? display(me) : ""} />
            <div className="os-row">
                {s.owners.some((o) => o === me) && <button type="button" className="os-btn" onClick={() => open(specForTarget({ kind: "app", app: "multisig", section: `${canonical}/propose` })!)}>New payment</button>}
                <CopyAddressButton address={display(canonical)} label={`Copy ${label} address`} />
            </div>
            {!me
                ? <ConnectHere resuming={session.status === "resuming"} onConnect={session.openConnect} text="Owners propose and sign this Safe's transactions here. Connect a wallet to see what waits for you." />
                : !s.owners.some((o) => o === me) && <p className="os-sub" role="status">This wallet is not an owner of this Safe.</p>}
            <section aria-label="Waiting to execute">
                <div className="os-row os-between"><h3 className="os-h">Waiting to execute</h3><button type="button" className="os-btn os-quiet" onClick={() => { void facts.refetch(); void queue.refetch() }}>Refresh</button></div>
                {queue.isPending ? <Loading what="the queue" />
                    : queue.isError ? <TxServiceError what="this Safe's queue" retry={() => void queue.refetch()} />
                    : queue.data.length === 0 ? <p className="os-sub">Nothing waits to execute.</p>
                    : <ul className="os-list">{queue.data.map((tx) => (
                        <QueueItem key={tx.safeTxHash} net={net} address={canonical} tx={tx} safe={s} me={me} network={label} clash={conflicts.get(tx.nonce.toString())}
                            refresh={() => { void facts.refetch(); void queue.refetch(); void history.refetch(); void balance.refetch() }} />
                    ))}</ul>}
            </section>
            <section aria-label="Executed">
                <h3 className="os-h">Executed</h3>
                {history.isPending ? <Loading what="the history" />
                    : history.isError ? <TxServiceError what="this Safe's history" retry={() => void history.refetch()} />
                    : history.data.length === 0 ? <p className="os-sub">No transaction executed yet.</p>
                    : <>{history.data.length === HISTORY_LIMIT && <p className="os-sub" role="status">Showing the {HISTORY_LIMIT} newest.</p>}<ul className="os-list">{history.data.map((tx) => {
                        const text = describeTx(tx.decoded)
                        const link = tx.transactionHash ? explorerTx(session.network.key, tx.transactionHash) : null
                        return (
                            <li key={tx.safeTxHash} className="os-it os-top">
                                <div className="os-grow">
                                    <b>#{tx.nonce.toString()} {text.title}</b>
                                    <div className="os-sub os-mono os-break">{text.detail}</div>
                                    <div className="os-sub">{tx.successful === false ? "Failed" : "Executed"}{tx.executionDate ? ` · ${new Date(tx.executionDate).toLocaleString("en-US")}` : ""}{link ? <> · <a href={link} target="_blank" rel="noreferrer">Transaction</a></> : null}</div>
                                </div>
                            </li>
                        )
                    })}</ul></>}
            </section>
        </div>
    )
}
