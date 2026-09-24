/**
 * The Wallet app (mockup v4 wallet) and the Send window (FLOWS.send): the
 * GNOT balance, Send and Receive, tokens (not on gnoland-1 yet, D27), and a
 * one-step send with a live summary, recent and saved recipients, the tiered
 * address check on mainnet (D17, D24) and the send lock for an unknown outcome.
 *
 * @module os/wallet/WalletWindows
 */
import { useEffect, useState } from "react"
import { ACTIVE_NETWORK_KEY, GNO_CHAIN_ID, GRC20_FACTORY_PATH, isRealmValidOn } from "../../lib/config"
import { feeForGasWanted, FALLBACK_GAS_PRICE, networkGasPrice, type GasPrice } from "../../lib/grc20"
import { AppTile } from "../shell/icons"
import type { OsSession } from "../shell/useOsSession"
import { appSpec, sendSpec, type WindowSpec } from "../shell/windows"
import { useSigner } from "../sign/signerContext"
import { Field, WizardFrame } from "../wizard/WizardFrame"
import {
    checkSend, clearSendLock, formatUgnot, MEMO_MAX, readRecipients, readSendLock, rememberRecipient, SEND_GAS_WANTED, type SendDraft,
} from "./send"
import { sendRequest } from "./sendRequest"

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
                <div className="os-sub os-mono os-break">{session.address}</div>
            </div>
            <div className="os-row">
                <button type="button" className="os-btn" onClick={() => open(sendSpec())}>Send</button>
                <button type="button" className="os-btn os-ghost" onClick={() => { void copy() }}>Receive</button>
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
    const [, rerender] = useState(0)

    useEffect(() => {
        let active = true
        networkGasPrice().then((p) => { if (active) setPrice(p) }, () => {})
        return () => { active = false }
    }, [])

    const people = readRecipients(GNO_CHAIN_ID, from)
    const known = (a: string) => people.recent.includes(a) || people.saved.includes(a)
    const fee = BigInt(feeForGasWanted(SEND_GAS_WANTED, price))
    const balance = session.layout.rawUgnot ?? null
    const c = checkSend(draft, { from, balance, fee, mainnet: !session.network.isTestnet, known })
    const set = (patch: Partial<SendDraft>) => setDraft((d) => ({ ...d, ...patch }))
    const shown = (f: "to" | "amount" | "memo", value: string) => ((showErrors || value !== "") ? c.problems[f] : undefined)

    const lock = readSendLock(GNO_CHAIN_ID, from)
    if (lock) {
        return (
            <div className="os-holding">
                <AppTile app="wallet" size={44} />
                <div className="os-holding-title">Outcome unknown</div>
                <p className="os-sub">The last attempt ({lock.label}) may have gone through. Check your balance and recent activity before sending again.</p>
                <label className="os-ack"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> I checked the previous transaction.</label>
                <button type="button" className="os-btn os-quiet" disabled={!checked} onClick={() => { clearSendLock(GNO_CHAIN_ID, from); setChecked(false); rerender((x) => x + 1) }}>Send again</button>
            </div>
        )
    }

    const submit = () => {
        if (Object.keys(c.problems).length || c.recipient?.kind !== "address" || c.ugnot === null) { setShowErrors(true); return }
        const to = c.recipient.address
        signer.sign({
            ...sendRequest({
                from, to, ugnot: c.ugnot, memo: draft.memo.trim(), feeUgnot: fee, tiers: c.tiers,
                // Asked of Adena at signing time, not read from this render's session.
                currentWallet: activeWalletAddress,
                onSent: () => { rememberRecipient(GNO_CHAIN_ID, from, to, draft.save) },
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
            note={`Network fee up to ${formatUgnot(fee)}.`}
            preview={(
                <div className="os-stack os-tight">
                    <h3 className="os-h os-flush">Summary</h3>
                    <div className="os-pvcard">
                        <span className="os-sub">You send</span>
                        <div className="os-big">{amountLabel}</div>
                        <span className="os-sub">to</span>
                        <b className="os-mono os-break">{c.recipient?.kind === "address" ? c.recipient.address : "—"}</b>
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
                    <div className="os-opt" role="radiogroup" aria-label="Asset">
                        <button type="button" role="radio" aria-checked="true"><b>GNOT</b><span className="os-sub">{balance === null ? "—" : formatUgnot(balance)} · native</span></button>
                        <button type="button" role="radio" aria-checked="false" disabled><b>Tokens</b><span className="os-sub">Not on {GNO_CHAIN_ID} yet</span></button>
                    </div>
                </Field>
                <Field label="To" htmlFor="os-send-to" error={shown("to", draft.to)}>
                    <input id="os-send-to" className="os-in os-mono" value={draft.to} onChange={(e) => set({ to: e.target.value })} placeholder="g1… address" autoComplete="off" spellCheck={false} />
                </Field>
                {c.recipient?.kind === "address" && !known(c.recipient.address) && <p className="os-note os-warn">New address: you haven't sent to it from this browser.</p>}
                {recents.length > 0 && (
                    <div className="os-chipset" aria-label="Recent recipients">
                        {recents.map((a) => (
                            <button key={a} type="button" aria-pressed={draft.to === a} onClick={() => set({ to: a })}>{people.saved.includes(a) ? "★ " : ""}{a.slice(0, 8)}…{a.slice(-4)}</button>
                        ))}
                    </div>
                )}
                <Field label="Amount" htmlFor="os-send-amount" error={shown("amount", draft.amount)}
                    hint={balance === null ? undefined : `Balance ${formatUgnot(balance)} · Max keeps the fee.`}>
                    <div className="os-row os-nowrap">
                        <input id="os-send-amount" className="os-in" inputMode="decimal" value={draft.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="0" autoComplete="off" />
                        <span className="os-sub">GNOT</span>
                        <button type="button" className="os-btn os-quiet" disabled={balance === null || balance <= fee}
                            onClick={() => balance !== null && set({ amount: formatUgnot(balance - fee).replace(/ GNOT$/, "").replace(/,/g, "") })}>Max</button>
                    </div>
                </Field>
                <Field label="Memo" htmlFor="os-send-memo" hint="Optional. Public on chain: never put secrets here." error={shown("memo", draft.memo)} count={`${[...draft.memo].length} / ${MEMO_MAX}`}>
                    <input id="os-send-memo" className="os-in" value={draft.memo} onChange={(e) => set({ memo: e.target.value })} placeholder="Optional note" autoComplete="off" />
                </Field>
                {c.recipient?.kind === "address" && !people.saved.includes(c.recipient.address) && (
                    <label className="os-ack"><input type="checkbox" checked={draft.save} onChange={(e) => set({ save: e.target.checked })} /> Save this address to my recipients</label>
                )}
            </div>
        </WizardFrame>
    )
}
