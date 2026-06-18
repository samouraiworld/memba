/**
 * PhasesSection — NFT Creator Studio section for setting the mint phase.
 *
 * Presents a phase selector (Draft / Allowlist / Public / Closed) with a
 * plain-language description for each phase. Saving calls SetMintPhase on-chain.
 * The allowlist Merkle root is managed separately in the Allowlist section (Task 9);
 * this section always passes allowlistRoot="" so it does not accidentally clobber it.
 */

import { useState } from "react"
import type { CollectionDetail as CollectionInfo } from "../../../lib/launchpad"
import { Phase, buildSetMintPhaseMsg } from "../../../lib/launchpad"
import type { PhaseValue } from "../../../lib/launchpad"
import { NFT_COLLECTIONS_PATH } from "../../../lib/nftConfig"
import type { AminoMsg } from "../../../lib/grc20"

// ── Phase metadata ────────────────────────────────────────────────────────────

interface PhaseOption {
    value: PhaseValue
    label: string
    description: string
}

const PHASE_OPTIONS: PhaseOption[] = [
    {
        value: Phase.Draft,
        label: "Draft",
        description: "Hidden; only you can admin-mint.",
    },
    {
        value: Phase.Allowlist,
        label: "Allowlist",
        description: "Only allowlisted wallets can mint — set the list in the Allowlist section.",
    },
    {
        value: Phase.Public,
        label: "Public",
        description: "Anyone can mint at the configured price.",
    },
    {
        value: Phase.Closed,
        label: "Closed",
        description: "Minting is closed.",
    },
]

function phaseDescription(phase: PhaseValue): string {
    return PHASE_OPTIONS.find((o) => o.value === phase)?.description ?? ""
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface PhasesSectionProps {
    id: string
    caller: string
    col: CollectionInfo
    run: (msg: AminoMsg, memo: string) => Promise<void>
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PhasesSection({ id, caller, col, run }: PhasesSectionProps) {
    const [selectedPhase, setSelectedPhase] = useState<PhaseValue>(
        (col.phase as PhaseValue) ?? Phase.Draft,
    )

    function handleSave() {
        void run(
            buildSetMintPhaseMsg(caller, NFT_COLLECTIONS_PATH, id, selectedPhase, ""),
            `Set phase ${id}`,
        )
    }

    return (
        <div className="studio-phases-section">
            <div className="manage-section">
                <h3 className="manage-section__heading">Mint phase</h3>
                <p className="manage-section__desc">
                    Control who can mint. Switch phases at any time — changes take effect on the next block.
                </p>
                <div className="manage-fields">
                    <label className="form-group">
                        <span>Phase</span>
                        <select
                            value={selectedPhase}
                            onChange={(e) => setSelectedPhase(Number(e.target.value) as PhaseValue)}
                        >
                            {PHASE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                        <small className="form-hint">{phaseDescription(selectedPhase)}</small>
                    </label>
                    <button className="btn-primary" onClick={handleSave}>
                        Save
                    </button>
                </div>
            </div>
        </div>
    )
}
