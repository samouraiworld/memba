/**
 * AllowlistSection — NFT Creator Studio section for building and publishing
 * the mint allowlist.
 *
 * Paste one `address,maxQty` entry per line → compute the Merkle root
 * client-side → publish the root on-chain with SetMintPhase(Allowlist).
 *
 * Ported from the `AllowlistBuilder` component in CollectionDetail.tsx (Task 9).
 */

import { useState, useCallback } from "react"
import { parseAllowlistText, computeAllowlistRoot } from "../../../lib/allowlistMerkle"
import { Phase, buildSetMintPhaseMsg } from "../../../lib/launchpad"
import { NFT_COLLECTIONS_PATH } from "../../../lib/nftConfig"
import type { AminoMsg } from "../../../lib/grc20"

// ── Props ─────────────────────────────────────────────────────────────────────

interface AllowlistSectionProps {
    id: string
    caller: string
    run: (msg: AminoMsg, memo: string) => Promise<void>
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AllowlistSection({ id, caller, run }: AllowlistSectionProps) {
    const [listText, setListText] = useState("")
    const [root, setRoot] = useState("")
    const [count, setCount] = useState(0)

    const compute = useCallback(async () => {
        const entries = parseAllowlistText(listText)
        setCount(entries.length)
        setRoot(await computeAllowlistRoot(entries))
    }, [listText])

    const download = useCallback(() => {
        const entries = parseAllowlistText(listText)
        const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `allowlist-${id.replace(/\//g, "_")}.json`
        a.click()
        URL.revokeObjectURL(url)
    }, [listText, id])

    const isEmpty = parseAllowlistText(listText).length === 0

    return (
        <div className="studio-allowlist-section">
            <div className="manage-section">
                <h3 className="manage-section__heading">Allowlist</h3>
                <p className="manage-section__desc">
                    Paste wallet addresses to restrict minting to a specific set of wallets. Compute
                    the Merkle root then publish it on-chain to activate the allowlist phase.
                </p>
                <div className="manage-fields">
                    <label className="form-group">
                        <span>Address list</span>
                        <textarea
                            value={listText}
                            onChange={(e) => setListText(e.target.value)}
                            placeholder={"g1abc...,2  (one address,qty per line)"}
                            rows={6}
                        />
                        <small className="form-hint">
                            One entry per line in <code>address,maxQty</code> format. Lines starting
                            with <code>#</code> and blank lines are ignored.
                        </small>
                    </label>

                    <button className="btn-secondary" onClick={() => void compute()}>
                        Compute root
                    </button>

                    {listText.trim() !== "" && isEmpty && (
                        <p className="form-validation">
                            No valid entries found. Use <code>address,qty</code> format, one per line.
                        </p>
                    )}

                    {root && (
                        <>
                            <small className="form-hint">
                                {count} entries · root <code>{root.slice(0, 16)}…</code>
                            </small>
                            <button className="btn-secondary" onClick={download}>
                                Download allowlist.json (publish so minters can prove)
                            </button>
                            <button
                                className="btn-primary"
                                onClick={() =>
                                    void run(
                                        buildSetMintPhaseMsg(
                                            caller,
                                            NFT_COLLECTIONS_PATH,
                                            id,
                                            Phase.Allowlist,
                                            root,
                                        ),
                                        `Set allowlist phase ${id}`,
                                    )
                                }
                            >
                                Set allowlist phase with this root
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}
