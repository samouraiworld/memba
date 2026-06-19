/**
 * WithdrawSection — NFT Creator Studio section for withdrawing mint proceeds.
 *
 * Sends accrued mint proceeds to the collection's mint-custody address
 * via WithdrawProceeds(id, denom).
 */

import { useState } from "react"
import { buildWithdrawProceedsMsg } from "../../../lib/launchpad"
import { NFT_COLLECTIONS_PATH } from "../../../lib/nftConfig"
import type { AminoMsg } from "../../../lib/grc20"

// ── Props ─────────────────────────────────────────────────────────────────────

interface WithdrawSectionProps {
    id: string
    caller: string
    run: (msg: AminoMsg, memo: string) => Promise<void>
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WithdrawSection({ id, caller, run }: WithdrawSectionProps) {
    const [denom, setDenom] = useState("ugnot")

    return (
        <div className="studio-withdraw-section">
            <div className="manage-section">
                <h3 className="manage-section__heading">Withdraw proceeds</h3>
                <p className="manage-section__desc">
                    Pull accrued mint proceeds to the collection's custody address.
                </p>
                <div className="manage-fields">
                    <label className="form-group" htmlFor="withdraw-denom">
                        <span>Denom</span>
                        <input
                            id="withdraw-denom"
                            value={denom}
                            onChange={(e) => setDenom(e.target.value)}
                            placeholder="ugnot"
                        />
                        <small className="form-hint">
                            Proceeds are sent to the collection's mint-custody address. Use{" "}
                            <code>ugnot</code> for native GNOT, or a GRC20 key for token proceeds.
                        </small>
                    </label>
                    <button
                        className="btn-primary"
                        onClick={() =>
                            void run(
                                buildWithdrawProceedsMsg(caller, NFT_COLLECTIONS_PATH, id, denom.trim()),
                                `Withdraw ${id}`,
                            )
                        }
                    >
                        Withdraw proceeds
                    </button>
                </div>
            </div>
        </div>
    )
}
