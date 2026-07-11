/**
 * MintSection — NFT Creator Studio section for minting tokens.
 *
 * Three mint pathways in order of prominence:
 *  1. Admin mint (promoted, top card) — no payment, any phase
 *  2. Public mint — open phase, attaches native price if applicable
 *  3. Allowlist mint — allowlist phase, requires proof derivation from paste list
 *
 * Logic ported unchanged from CollectionDetail.tsx (MintPublicForm,
 * AllowlistMintForm, ManagePanel admin-mint block).
 *
 * Curated mint flow (Membas Genesis): when the backend mint-ticket endpoint is
 * live, the public/allowlist forms use the ticket's suggested tokenURI instead
 * of a manual input, and the allowlist proof auto-loads from the server (the
 * paste flow stays as fallback). tids are assigned at execution on-chain and
 * URIs are immutable after mint, so a concurrent mint can shift the queue —
 * detected as a tid jump after our mint and surfaced as a "Misprint" notice.
 */

import { useState, useCallback, useEffect, useRef } from "react"
import type { CollectionDetail as CollectionInfo } from "../../../lib/launchpad"
import {
    buildAdminMintMsg,
    buildMintPublicMsg,
    buildMintAllowlistMsg,
} from "../../../lib/launchpad"
import { parseAllowlistText, getAllowlistProof } from "../../../lib/allowlistMerkle"
import { fetchMintTicket, fetchAllowlistProof } from "../../../lib/nftApi"
import type { MintTicket, AllowlistProof } from "../../../lib/nftApi"
import { NFT_COLLECTIONS_PATH } from "../../../lib/nftConfig"
import type { AminoMsg } from "../../../lib/grc20"

// ── Props ─────────────────────────────────────────────────────────────────────

interface MintSectionProps {
    id: string
    caller: string
    col: CollectionInfo
    run: (msg: AminoMsg, memo: string) => Promise<void>
}

/** "ipfs://CID/Memba_0004.json" -> "Memba #0004" (falls back to #edition). */
function ticketLabel(t: MintTicket): string {
    const stem = (t.tokenURI.split("/").pop() ?? "").replace(/\.json$/, "")
    if (stem.includes("_")) return stem.replace("_", " #")
    return `#${String(t.edition).padStart(4, "0")}`
}

function TicketHint({ ticket }: { ticket: MintTicket }) {
    return (
        <small className="form-hint">
            Next mint: <strong>{ticketLabel(ticket)}</strong> — metadata is assigned
            automatically for this collection.
        </small>
    )
}

// ── Sub-component: Public mint form (ported from CollectionDetail.tsx:287-301) ─

function MintPublicForm({
    id,
    priceUgnot,
    caller,
    ticket,
    onRun,
}: {
    id: string
    priceUgnot: number
    caller: string
    ticket: MintTicket | null
    onRun: (msg: AminoMsg, memo: string) => Promise<void>
}) {
    const [uri, setUri] = useState("")
    const mintUri = ticket ? ticket.tokenURI : uri
    return (
        <div className="manage-fields">
            {ticket ? (
                <TicketHint ticket={ticket} />
            ) : (
                <label className="form-group">
                    <span>Token URI</span>
                    <input
                        value={uri}
                        onChange={(e) => setUri(e.target.value)}
                        placeholder="ipfs://… (leave blank for on-chain default)"
                    />
                    <small className="form-hint">IPFS or HTTP URI for the token's metadata. Optional.</small>
                </label>
            )}
            <button
                className="btn-primary"
                onClick={() =>
                    void onRun(
                        buildMintPublicMsg(caller, NFT_COLLECTIONS_PATH, id, mintUri, priceUgnot),
                        `Mint ${id}`,
                    )
                }
            >
                Mint{priceUgnot > 0 ? ` (${priceUgnot / 1_000_000} GNOT)` : " (free)"}
            </button>
        </div>
    )
}

// ── Sub-component: Allowlist mint form (ported from CollectionDetail.tsx:459-508) ─

function AllowlistMintForm({
    id,
    priceUgnot,
    caller,
    ticket,
    serverProof,
    onRun,
}: {
    id: string
    priceUgnot: number
    caller: string
    ticket: MintTicket | null
    serverProof: AllowlistProof | null
    onRun: (msg: AminoMsg, memo: string) => Promise<void>
}) {
    const [listText, setListText] = useState("")
    const [uri, setUri] = useState("")
    const [status, setStatus] = useState<string | null>(null)
    const [pasteDerived, setPasteDerived] = useState<{ maxQty: number; proof: string[] } | null>(null)

    // Server-side proof (Genesis flow): derived straight from the prop — no
    // pasting needed, and no state mirroring (react-hooks/set-state-in-effect).
    const derived = serverProof
        ? {
              maxQty: serverProof.maxQty,
              proof: serverProof.proof === "" ? [] : serverProof.proof.split(","),
          }
        : pasteDerived
    const shownStatus =
        serverProof != null
            ? `✓ Allowlisted for ${serverProof.maxQty}. Proof loaded — ready to mint.`
            : status

    const check = useCallback(async () => {
        setStatus(null)
        setPasteDerived(null)
        const entries = parseAllowlistText(listText)
        if (entries.length === 0) {
            setStatus("No valid entries in the pasted list.")
            return
        }
        const p = await getAllowlistProof(entries, caller)
        if (!p) {
            setStatus("Your address is not on this allowlist.")
            return
        }
        setPasteDerived(p)
        setStatus(`✓ Allowlisted for ${p.maxQty}. Ready to mint.`)
    }, [listText, caller])

    const mintUri = ticket ? ticket.tokenURI : uri

    return (
        <div className="manage-fields">
            {!serverProof && (
                <>
                    <label className="form-group">
                        <span>Allowlist (paste to verify)</span>
                        <textarea
                            value={listText}
                            onChange={(e) => setListText(e.target.value)}
                            placeholder={"g1abc...,2\ng1def...,1"}
                            rows={4}
                        />
                        <small className="form-hint">
                            Allowlist phase — paste the creator's published list (one{" "}
                            <code>address,qty</code> per line) to derive your proof.
                        </small>
                    </label>
                    <button onClick={() => void check()}>Check allowlist</button>
                </>
            )}
            {shownStatus && <small className="form-hint">{shownStatus}</small>}
            {derived && (
                <>
                    {ticket ? (
                        <TicketHint ticket={ticket} />
                    ) : (
                        <label className="form-group">
                            <span>Token URI</span>
                            <input
                                value={uri}
                                onChange={(e) => setUri(e.target.value)}
                                placeholder="ipfs://… (leave blank for on-chain default)"
                            />
                            <small className="form-hint">IPFS or HTTP URI for the token's metadata. Optional.</small>
                        </label>
                    )}
                    <button
                        className="btn-primary"
                        onClick={() =>
                            void onRun(
                                buildMintAllowlistMsg(
                                    caller,
                                    NFT_COLLECTIONS_PATH,
                                    id,
                                    derived.proof,
                                    derived.maxQty,
                                    mintUri,
                                    priceUgnot,
                                ),
                                `Allowlist mint ${id}`,
                            )
                        }
                    >
                        Mint (allowlist){priceUgnot > 0 ? ` (${priceUgnot / 1_000_000} GNOT)` : ""}
                    </button>
                </>
            )}
        </div>
    )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function MintSection({ id, caller, col, run }: MintSectionProps) {
    const [mintTo, setMintTo] = useState(caller)
    const [mintUri, setMintUri] = useState("")
    // Ticket/proof are stored KEYED BY COLLECTION and derived against the
    // current `id`: switching collections in the multi-tenant Studio instantly
    // yields null (no stale curated state can leak into another collection's
    // mint form), and the backend additionally scopes tickets server-side.
    const [ticketFor, setTicketFor] = useState<{ id: string; ticket: MintTicket } | null>(null)
    const [proofFor, setProofFor] = useState<{ id: string; proof: AllowlistProof } | null>(null)
    const [misprint, setMisprint] = useState(false)
    const ticket = ticketFor?.id === id ? ticketFor.ticket : null
    const serverProof = proofFor?.id === id ? proofFor.proof : null

    const aliveRef = useRef(true)
    useEffect(() => {
        aliveRef.current = true
        return () => {
            aliveRef.current = false
        }
    }, [])

    useEffect(() => {
        let alive = true
        void fetchMintTicket(id).then((t) => {
            if (!alive) return
            setTicketFor(t ? { id, ticket: t } : null)
            // The ticket doubles as the "is this the curated collection?"
            // signal — only then is the Genesis allowlist proof relevant.
            if (t) {
                void fetchAllowlistProof(caller).then((p) => alive && setProofFor(p ? { id, proof: p } : null))
            } else {
                setProofFor(null)
            }
        })
        return () => {
            alive = false
        }
    }, [caller, id])

    // Refresh the ticket after every mint attempt; a tid jump past ours means a
    // concurrent mint landed while ours was printing (possible Misprint).
    // In-flight guard: a second click before the refresh lands would reuse the
    // same stale ticket URI and mint duplicate metadata.
    const mintingRef = useRef(false)
    const runAndRefresh = useCallback(
        async (msg: AminoMsg, memo: string) => {
            if (mintingRef.current) return
            mintingRef.current = true
            try {
                const before = ticket?.tid ?? null
                await run(msg, memo)
                const next = await fetchMintTicket(id)
                if (!aliveRef.current) return
                setTicketFor(next ? { id, ticket: next } : null)
                if (before !== null && next !== null && next.tid > before + 1) {
                    setMisprint(true)
                }
            } finally {
                mintingRef.current = false
            }
        },
        [run, ticket, id],
    )

    // Derive native price for public/allowlist mint builders
    const isNative = col.payDenom === "" || col.payDenom === "ugnot"
    const priceUgnot = isNative ? col.mintPrice : 0

    return (
        <div className="studio-mint-section">
            {/* ── Admin mint (promoted, top card) ── */}
            <div className="manage-section manage-section--primary">
                <h3 className="manage-section__heading">Admin mint</h3>
                <p className="manage-section__desc">
                    Mint straight to a wallet — no payment, works in any phase.
                </p>
                <div className="manage-fields">
                    <label className="form-group">
                        <span>Recipient address</span>
                        <input
                            value={mintTo}
                            onChange={(e) => setMintTo(e.target.value)}
                            placeholder="g1… (defaults to your connected wallet)"
                        />
                        <small className="form-hint">The wallet that will receive the minted token.</small>
                    </label>
                    <label className="form-group">
                        <span>Token URI</span>
                        <input
                            value={mintUri}
                            onChange={(e) => setMintUri(e.target.value)}
                            placeholder="ipfs://… or any URI (leave blank for default)"
                        />
                        <small className="form-hint">
                            Metadata URI for this token, e.g. <code>ipfs://Qm…</code>. Optional.
                        </small>
                    </label>
                    <button
                        className="btn-primary"
                        onClick={() =>
                            void runAndRefresh(
                                buildAdminMintMsg(caller, NFT_COLLECTIONS_PATH, id, mintTo.trim(), mintUri),
                                `Admin mint ${id}`,
                            )
                        }
                    >
                        Mint to recipient
                    </button>
                </div>
            </div>

            {/* ── Public and allowlist mint ── */}
            <section>
                <h3>Public / Allowlist Mint</h3>
                <MintPublicForm id={id} priceUgnot={priceUgnot} caller={caller} ticket={ticket} onRun={runAndRefresh} />
                <AllowlistMintForm
                    id={id}
                    priceUgnot={priceUgnot}
                    caller={caller}
                    ticket={ticket}
                    serverProof={serverProof}
                    onRun={runAndRefresh}
                />
                {misprint && (
                    <small className="form-hint">
                        Misprint possible: another mint landed while yours was printing. If your
                        Memba's art differs from the preview, that's a Misprint — authentic, and
                        listed on the public errata. Rebel print shops are like that.
                    </small>
                )}
            </section>
        </div>
    )
}
