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
 */

import { useState, useCallback } from "react"
import type { CollectionDetail as CollectionInfo } from "../../../lib/launchpad"
import {
    buildAdminMintMsg,
    buildMintPublicMsg,
    buildMintAllowlistMsg,
} from "../../../lib/launchpad"
import { parseAllowlistText, getAllowlistProof } from "../../../lib/allowlistMerkle"
import { NFT_COLLECTIONS_PATH } from "../../../lib/nftConfig"
import type { AminoMsg } from "../../../lib/grc20"

// ── Props ─────────────────────────────────────────────────────────────────────

interface MintSectionProps {
    id: string
    caller: string
    col: CollectionInfo
    run: (msg: AminoMsg, memo: string) => Promise<void>
}

// ── Sub-component: Public mint form (ported from CollectionDetail.tsx:287-301) ─

function MintPublicForm({
    id,
    priceUgnot,
    caller,
    onRun,
}: {
    id: string
    priceUgnot: number
    caller: string
    onRun: (msg: AminoMsg, memo: string) => Promise<void>
}) {
    const [uri, setUri] = useState("")
    return (
        <div className="manage-fields">
            <label className="form-group">
                <span>Token URI</span>
                <input
                    value={uri}
                    onChange={(e) => setUri(e.target.value)}
                    placeholder="ipfs://… (leave blank for on-chain default)"
                />
                <small className="form-hint">IPFS or HTTP URI for the token's metadata. Optional.</small>
            </label>
            <button
                className="btn-primary"
                onClick={() =>
                    void onRun(
                        buildMintPublicMsg(caller, NFT_COLLECTIONS_PATH, id, uri, priceUgnot),
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
    onRun,
}: {
    id: string
    priceUgnot: number
    caller: string
    onRun: (msg: AminoMsg, memo: string) => Promise<void>
}) {
    const [listText, setListText] = useState("")
    const [uri, setUri] = useState("")
    const [status, setStatus] = useState<string | null>(null)
    const [derived, setDerived] = useState<{ maxQty: number; proof: string[] } | null>(null)

    const check = useCallback(async () => {
        setStatus(null)
        setDerived(null)
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
        setDerived(p)
        setStatus(`✓ Allowlisted for ${p.maxQty}. Ready to mint.`)
    }, [listText, caller])

    return (
        <div className="manage-fields">
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
            {status && <small className="form-hint">{status}</small>}
            {derived && (
                <>
                    <label className="form-group">
                        <span>Token URI</span>
                        <input
                            value={uri}
                            onChange={(e) => setUri(e.target.value)}
                            placeholder="ipfs://… (leave blank for on-chain default)"
                        />
                        <small className="form-hint">IPFS or HTTP URI for the token's metadata. Optional.</small>
                    </label>
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
                                    uri,
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
                            void run(
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
                <MintPublicForm id={id} priceUgnot={priceUgnot} caller={caller} onRun={run} />
                <AllowlistMintForm id={id} priceUgnot={priceUgnot} caller={caller} onRun={run} />
            </section>
        </div>
    )
}
