/**
 * SettingsSection — mint config form with GNOT-denominated, validated price.
 *
 * This is the fix for the `mint price out of range` realm error: users enter
 * the price in GNOT, it is validated client-side (0 = free, or >= 0.001 GNOT),
 * converted to ugnot, and a sub-minimum value can never reach the chain.
 */

import { useState } from "react"
import type { AminoMsg } from "../../../lib/grc20"
import { validateMintPrice } from "../../../lib/mintPrice"
import { buildSetMintConfigMsg } from "../../../lib/launchpad"
import { NFT_COLLECTIONS_PATH } from "../../../lib/nftConfig"

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a string to a non-negative integer; fall back to 0. */
const num = (s: string) => Math.max(0, parseInt(s, 10) || 0)

// ── Props ─────────────────────────────────────────────────────────────────────

interface SettingsSectionProps {
    id: string
    caller: string
    run: (msg: AminoMsg, memo: string) => Promise<void>
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SettingsSection({ id, caller, run }: SettingsSectionProps) {
    const [price, setPrice] = useState("")
    const [denom, setDenom] = useState("")
    const [maxSupply, setMaxSupply] = useState("")
    const [maxPerWallet, setMaxPerWallet] = useState("")
    const [startBlock, setStartBlock] = useState("")
    const [cooldown, setCooldown] = useState("")

    const priceCheck = validateMintPrice(price)

    function handleSave() {
        if (!priceCheck.ok) return
        void run(
            buildSetMintConfigMsg(caller, NFT_COLLECTIONS_PATH, id, {
                mintPrice: priceCheck.ugnot,
                payDenom: denom.trim(),
                maxSupply: num(maxSupply),
                maxPerWallet: num(maxPerWallet),
                mintStartBlock: num(startBlock),
                mintCooldownBlocks: num(cooldown),
            }),
            `Set mint config ${id}`,
        )
    }

    return (
        <div className="studio-settings-section">
            <h2>Settings</h2>

            <label className="form-group" htmlFor="settings-mint-price">
                <span>Mint price (GNOT)</span>
                <input
                    id="settings-mint-price"
                    type="text"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="0"
                    aria-describedby="settings-mint-price-hint settings-mint-price-error"
                />
            </label>
            <small id="settings-mint-price-hint" className="form-hint">
                0 for a free mint · minimum 0.001 GNOT
            </small>
            {priceCheck.error && (
                <p id="settings-mint-price-error" className="form-error" role="alert">
                    {priceCheck.error}
                </p>
            )}

            <label className="form-group" htmlFor="settings-pay-denom">
                <span>Pay denom</span>
                <input
                    id="settings-pay-denom"
                    type="text"
                    value={denom}
                    onChange={(e) => setDenom(e.target.value)}
                    placeholder=""
                    aria-describedby="settings-pay-denom-hint"
                />
            </label>
            <small id="settings-pay-denom-hint" className="form-hint">
                Leave blank for native GNOT
            </small>

            <label className="form-group" htmlFor="settings-max-supply">
                <span>Max supply</span>
                <input
                    id="settings-max-supply"
                    type="number"
                    min="0"
                    value={maxSupply}
                    onChange={(e) => setMaxSupply(e.target.value)}
                    placeholder="0"
                    aria-describedby="settings-max-supply-hint"
                />
            </label>
            <small id="settings-max-supply-hint" className="form-hint">
                0 = unlimited
            </small>

            <label className="form-group" htmlFor="settings-max-per-wallet">
                <span>Max per wallet</span>
                <input
                    id="settings-max-per-wallet"
                    type="number"
                    min="0"
                    value={maxPerWallet}
                    onChange={(e) => setMaxPerWallet(e.target.value)}
                    placeholder="0"
                    aria-describedby="settings-max-per-wallet-hint"
                />
            </label>
            <small id="settings-max-per-wallet-hint" className="form-hint">
                0 = unlimited
            </small>

            <label className="form-group" htmlFor="settings-start-block">
                <span>Mint start block</span>
                <input
                    id="settings-start-block"
                    type="number"
                    min="0"
                    value={startBlock}
                    onChange={(e) => setStartBlock(e.target.value)}
                    placeholder="0"
                    aria-describedby="settings-start-block-hint"
                />
            </label>
            <small id="settings-start-block-hint" className="form-hint">
                0 = open now
            </small>

            <label className="form-group" htmlFor="settings-cooldown">
                <span>Cooldown blocks</span>
                <input
                    id="settings-cooldown"
                    type="number"
                    min="0"
                    value={cooldown}
                    onChange={(e) => setCooldown(e.target.value)}
                    placeholder="0"
                    aria-describedby="settings-cooldown-hint"
                />
            </label>
            <small id="settings-cooldown-hint" className="form-hint">
                0 = none
            </small>

            <button
                type="button"
                className="btn-primary"
                disabled={!priceCheck.ok}
                onClick={handleSave}
            >
                Save
            </button>
        </div>
    )
}
