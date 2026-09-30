/**
 * The Wallet app (mockup v4 wallet) and the Send window (FLOWS.send): the
 * GNOT balance, Send and Receive, tokens (not on gnoland-1 yet, D27), and a
 * one-step send with a live summary, recent and saved recipients, the tiered
 * address check on mainnet (D17, D24) and the send lock for an unknown outcome.
 *
 * @module os/wallet/WalletWindows
 */
import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { ACTIVE_NETWORK_KEY, GNO_CHAIN_ID, GRC20_FACTORY_PATH, isRealmValidOn } from "../../lib/config"
import { feeForGasWanted, FALLBACK_GAS_PRICE, networkGasPrice, networkGasPriceFresh, type GasPrice } from "../../lib/grc20"
import { mainnetSubmissionTxUrl } from "../../lib/recentSubmissions"
import { AppTile } from "../shell/icons"
import type { OsSession } from "../shell/useOsSession"
import { appSpec, sendSpec, type WindowSpec } from "../shell/windows"
import { useSigner } from "../sign/signerContext"
import { Field, WizardFrame } from "../wizard/WizardFrame"
import {
    checkSend, clearRecipients, clearSendLock, formatUgnot, lookUpName, MEMO_MAX, nameToLookUp, readRecipients, readSendLock, recipientAddress, rememberRecipient, SEND_GAS_WANTED,
    type NameLookup, type SendDraft,
} from "./send"
import { sendRequest, verifySendTx } from "./sendRequest"

/** The account Adena is on right now ("" when it can't say). */
async function activeWalletAddress(): Promise<string> {
    try {
        const adena = (window as unknown as { adena?: { GetAccount?: () => Promise<{ data?: { address?: string } }> } }).adena
        return (await adena?.GetAccount?.())?.data?.address ?? ""
    } catch {
        return ""
    }
}

function ConnectGate({ session, what }: { session: OsSession; what: string }) {
    return (
        <div className="os-holding">
            <AppTile app="wallet" size={44} />
            <div className="os-holding-title">No wallet connected</div>
            <p className="os-sub">Connect Adena to {what}.</p>
            <button type="button" className="os-btn" onClick={session.openConnect}>Connect wallet</button>
        </div>
    )
}

export function WalletWindow({ session, open, toast }: { session: OsSession; open: (spec: WindowSpec) => void; toast: (msg: string) => void }) {
    if (session.status !== "member") return <ConnectGate session={session} what="see your balance, send GNOT and sign transactions" />
    const raw = session.layout.rawUgnot
    const copy = async () => {
        try { await navigator.clipboard.writeText(session.address); toast("Address copied") } catch { toast("Couldn't copy. Select the address instead.") }
    }
    return (
        <div className="os-stack">
            <div>
                <h3 className="os-h">Balance · {GNO_CHAIN_ID}</h3>
                <div className="os-big">{raw === undefined ? session.layout.balance : formatUgnot(raw)}</div>
                {session.balanceError && <p className="os-note os-warn" role="status">Balance unavailable. Check your wallet before sending.</p>}
                <button type="button" className="os-btn os-quiet" onClick={() => { void session.refreshBalance() }}>Refresh balance</button>
                <div className="os-sub os-mono os-break">{session.address}</div>
            </div>
            <div className="os-row">
                <button type="button" className="os-btn" onClick={() => open(sendSpec())}>Send</button>
                <button type="button" className="os-btn os-ghost" onClick={() => { void copy() }}>Copy receive address</button>
            </div>
            <div>
                <h3 className="os-h">Tokens</h3>
                {isRealmValidOn(ACTIVE_NETWORK_KEY, GRC20_FACTORY_PATH) ? (
                    <div className="os-card os-row">
                        <div className="os-grow"><b>GRC20 tokens</b><div className="os-sub">Balances and transfers live in the Tokens app for now.</div></div>
                        <button type="button" className="os-btn os-quiet" onClick={() => open(appSpec("tokens"))}>Open Tokens</button>
                    </div>
                ) : (
                    <div className="os-card os-row os-dim">
                        <div className="os-grow"><b>GRC20 tokens</b><div className="os-sub">Token balances and token sends.</div></div>
                        <span className="os-pill">Not on {GNO_CHAIN_ID} yet</span>
                    </div>
                )}
            </div>
        </div>
    )
}

export function SendWindow({ session, close }: { session: OsSession; close: () => void }) {
    if (session.status !== "member") return <ConnectGate session={session} what="send GNOT" />
    // Keyed by wallet: recipients and the send lock belong to one wallet.
    return <SendForm key={`${GNO_CHAIN_ID}:${session.address}`} session={session} close={close} />
}

function SendForm({ session, close }: { session: OsSession; close: () => void }) {
    const signer = useSigner()
    const from = session.address
    const [draft, setDraft] = useState<SendDraft>({ to: "", amount: "", memo: "", save: false })
    const [showErrors, setShowErrors] = useState(false)
    const [price, setPrice] = useState<GasPrice>(FALLBACK_GAS_PRICE)
    const [checked, setChecked] = useState(false)
    const [checkingStatus, setCheckingStatus] = useState(false)
    const [statusNote, setStatusNote] = useState("")
    const [, rerender] = useState(0)

    // Another tab may start or resolve a send while this form is open.
    useEffect(() => {
        const changed = (event: StorageEvent) => {
            if (event.key === `memba_os_send_lock:${GNO_CHAIN_ID}:${from}`) rerender((x) => x + 1)
        }
        window.addEventListener("storage", changed)
        return () => window.removeEventListener("storage", changed)
    }, [from])

    useEffect(() => {
        let active = true
        networkGasPrice().then((p) => { if (active) setPrice(p) }, () => {})
        return () => { active = false }
    }, [])

    // @name recipients (D23): looked up through the shared resolver (#1305) once typing pauses.
    const typedName = nameToLookUp(draft.to)
    const [lookupName, setLookupName] = useState<string | null>(null)
    useEffect(() => {
        const t = setTimeout(() => setLookupName(typedName), 350)
        return () => clearTimeout(t)
    }, [typedName])
    const names = useQuery({
        queryKey: ["os-send-name", GNO_CHAIN_ID, lookupName],
        queryFn: () => lookUpName(lookupName ?? ""),
        enabled: lookupName !== null,
        staleTime: 60_000,
        retry: false,
    })
    // Only an answer for exactly what is typed now counts; anything else is still loading.
    const lookup = (atName: string): NameLookup =>
        atName !== lookupName || names.isPending ? { status: "loading" } : names.data ?? { status: "error", name: atName.slice(1) }

    const people = readRecipients(GNO_CHAIN_ID, from)
    const known = (a: string) => people.recent.includes(a) || people.saved.includes(a)
    const fee = BigInt(feeForGasWanted(SEND_GAS_WANTED, price))
    const balance = session.layout.rawUgnot ?? null
    const c = checkSend(draft, { from, balance, fee, mainnet: !session.network.isTestnet, known, lookup })
    const to = recipientAddress(c.recipient)
    const set = (patch: Partial<SendDraft>) => setDraft((d) => ({ ...d, ...patch }))
    const shown = (f: "to" | "amount" | "memo", value: string) => ((showErrors || value !== "") ? c.problems[f] : undefined)

    const lock = readSendLock(GNO_CHAIN_ID, from)
    if (lock) {
        const txUrl = mainnetSubmissionTxUrl(lock.hash, GNO_CHAIN_ID)
        const checkStatus = async () => {
            setCheckingStatus(true)
            try {
                if (await verifySendTx(lock.hash)) {
                    const current = readSendLock(GNO_CHAIN_ID, from)
                    if (current?.id !== lock.id || current?.hash !== lock.hash) return
                    if (current.to) rememberRecipient(GNO_CHAIN_ID, from, current.to, !!current.save)
                    clearSendLock(GNO_CHAIN_ID, from, lock.id)
                    setStatusNote("Confirmed on chain. You can prepare another send.")
                    rerender((x) => x + 1)
                } else setStatusNote("The network has not confirmed this transaction yet. Check again later.")
            } catch {
                setStatusNote("The network could not check this transaction. Keep the send on hold.")
            } finally { setCheckingStatus(false) }
        }
        return (
            <div className="os-holding">
                <AppTile app="wallet" size={44} />
                <div className="os-holding-title">{lock.hash ? "Waiting for confirmation" : "Outcome unknown"}</div>
                <p className="os-sub">The last attempt ({lock.label}) may have gone through. Check your wallet history and balance before sending again.</p>
                <button type="button" className="os-btn os-quiet" onClick={() => { void session.refreshBalance() }}>Refresh balance</button>
                {lock.hash && <><code className="os-mono os-break">{lock.hash}</code>{txUrl && <a href={txUrl} target="_blank" rel="noreferrer">Check transaction on the network</a>}</>}
                {lock.hash && <button type="button" className="os-btn os-quiet" disabled={checkingStatus} onClick={() => { void checkStatus() }}>{checkingStatus ? "Checking…" : "Check status"}</button>}
                {statusNote && <p className="os-note" role="status">{statusNote}</p>}
                <label className="os-ack"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> I checked the previous transaction.</label>
                <button type="button" className="os-btn os-quiet" disabled={!checked} onClick={() => { clearSendLock(GNO_CHAIN_ID, from, lock.id); setChecked(false); rerender((x) => x + 1) }}>Send again</button>
            </div>
        )
    }

    const submit = () => {
        if (readSendLock(GNO_CHAIN_ID, from)) { rerender((x) => x + 1); return }
        if (Object.keys(c.problems).length || to === null || c.ugnot === null) { setShowErrors(true); return }
        signer.sign({
            ...sendRequest({
                from, to, ugnot: c.ugnot, memo: draft.memo.trim(), feeUgnot: fee, tiers: c.tiers,
                toName: c.recipient?.kind === "name" ? c.recipient.name : undefined,
                // Asked of Adena at signing time, not read from this render's session.
                currentWallet: activeWalletAddress,
                currentFee: async () => {
                    const fresh = await networkGasPriceFresh()
                    setPrice(fresh)
                    return BigInt(feeForGasWanted(SEND_GAS_WANTED, fresh))
                },
                onSent: () => { rememberRecipient(GNO_CHAIN_ID, from, to, draft.save) },
                saveRecipient: draft.save,
            }),
            onSettled: (o) => {
                if (o === "confirmed" || o === "submitted") close()
                else rerender((x) => x + 1) // an unknown outcome shows the lock
            },
        })
    }

    const recents = [...new Set([...people.saved, ...people.recent])]
    const amountLabel = c.ugnot === null ? "0 GNOT" : formatUgnot(c.ugnot)
    return (
        <WizardFrame steps={["Send"]} step={0} onNext={submit} nextLabel="Review…"
            note={`Network fee ${formatUgnot(fee)}.`}
            preview={(
                <div className="os-stack os-tight">
                    <h3 className="os-h os-flush">Summary</h3>
                    <div className="os-pvcard">
                        <span className="os-sub">You send</span>
                        <div className="os-big">{amountLabel}</div>
                        <span className="os-sub">to</span>
                        {c.recipient?.kind === "name" && <b>@{c.recipient.name}</b>}
                        <b className="os-mono os-break">{to ?? "—"}</b>
                    </div>
                    <dl className="os-kv">
                        <div className="os-kv-row"><dt>Network</dt><dd>{GNO_CHAIN_ID}</dd></div>
                        <div className="os-kv-row"><dt>Fee</dt><dd>up to {formatUgnot(fee)}</dd></div>
                    </dl>
                    {c.tiers.length > 0 && <p className="os-note os-warn">Extra check at review: {c.tiers.join(" · ")}</p>}
                </div>
            )}>
            <div className="os-stack">
                <Field label="Asset">
                    <div className="os-opt" aria-label="Asset">
                        <div className="os-asset os-asset-selected"><b>GNOT</b><span className="os-sub">{balance === null ? "Balance unavailable" : formatUgnot(balance)} · native</span></div>
                        <div className="os-asset os-dim"><b>Tokens</b><span className="os-sub">Not on {GNO_CHAIN_ID} yet</span></div>
                    </div>
                </Field>
                <Field label="To" htmlFor="os-send-to" error={shown("to", draft.to)}>
                    <input id="os-send-to" className="os-in os-mono" value={draft.to} onChange={(e) => set({ to: e.target.value })} placeholder="@name or g1… address" autoComplete="off" spellCheck={false} aria-invalid={!!shown("to", draft.to)} aria-describedby={shown("to", draft.to) ? "os-send-to-detail" : undefined} />
                </Field>
                {c.recipient?.kind === "name" && <p className="os-note" aria-live="polite">@{c.recipient.name} is <span className="os-mono os-break">{c.recipient.address}</span></p>}
                {to !== null && !known(to) && <p className="os-note os-warn">New address: you haven't sent to it from this browser.</p>}
                {recents.length > 0 && (
                    <div>
                        <div className="os-chipset" aria-label="Recent recipients">
                            {recents.map((a) => (
                                <button key={a} type="button" aria-label={`${people.saved.includes(a) ? "Saved" : "Recent"} recipient ${a}`} aria-pressed={draft.to === a} onClick={() => set({ to: a })}>{people.saved.includes(a) ? "★ " : ""}{a.slice(0, 8)}…{a.slice(-4)}</button>
                            ))}
                        </div>
                        <p className="os-sub">Recent recipients stay in this browser even when not saved.</p>
                        <button type="button" className="os-btn os-quiet" onClick={() => { clearRecipients(GNO_CHAIN_ID, from); rerender((x) => x + 1) }}>Clear recipients on this browser</button>
                    </div>
                )}
                <Field label="Amount" htmlFor="os-send-amount" error={shown("amount", draft.amount)}
                    hint={balance === null ? undefined : `Balance ${formatUgnot(balance)} · Max keeps the fee.`}>
                    <div className="os-row os-nowrap">
                        <input id="os-send-amount" className="os-in" inputMode="decimal" value={draft.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="0" autoComplete="off" aria-invalid={!!shown("amount", draft.amount)} aria-describedby={shown("amount", draft.amount) || balance !== null ? "os-send-amount-detail" : undefined} />
                        <span className="os-sub">GNOT</span>
                        <button type="button" className="os-btn os-quiet" disabled={balance === null || balance <= fee}
                            onClick={() => balance !== null && set({ amount: formatUgnot(balance - fee).replace(/ GNOT$/, "").replace(/,/g, "") })}>Max</button>
                    </div>
                </Field>
                <Field label="Memo" htmlFor="os-send-memo" hint="Optional. Public on chain: never put secrets here." error={shown("memo", draft.memo)} count={`${[...draft.memo].length} / ${MEMO_MAX}`}>
                    <input id="os-send-memo" className="os-in" value={draft.memo} onChange={(e) => set({ memo: e.target.value })} placeholder="Optional note" autoComplete="off" aria-invalid={!!shown("memo", draft.memo)} aria-describedby="os-send-memo-detail" />
                </Field>
                {to !== null && !people.saved.includes(to) && (
                    <label className="os-ack"><input type="checkbox" checked={draft.save} onChange={(e) => set({ save: e.target.checked })} /> Keep this address in saved recipients</label>
                )}
            </div>
        </WizardFrame>
    )
}
