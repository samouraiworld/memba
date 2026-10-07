import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { APP_VERSION } from "../../../lib/config"
import { getGasConfig, MAX_DEFAULT_GAS_FEE_UGNOT, MAX_DEFAULT_GAS_WANTED, parseDefaultGasInput } from "../../../lib/gasConfig"
import { useOsAppearance, type OsIconSize } from "../../appearance"
import { setLiveWidget, setSkipIntro, useLiveWidget, useSkipIntro } from "../../preferences"
import { AppShell, type ShellSection } from "../../kit"
import type { NativeViewProps } from "../../native/types"
import { specForTarget } from "../../shell/windows"
import { selectableOsNetworks, switchOsNetwork } from "../../shell/network"
import { EVM_ENABLED } from "../../../lib/chain/flag"
import { WALLPAPERS } from "../../wallpapers"
import { resetLocalUiData } from "./localData"
import "./native.css"

const sections: readonly ShellSection[] = [
    { id: "desktop", name: "Desktop", icon: "set" },
    { id: "notifications", name: "Notifications", icon: "live" },
    { id: "safety", name: "Safety", icon: "val" },
    { id: "network", name: "Network", icon: "exp" },
    { id: "transactions", name: "Transactions", icon: "wal" },
    { id: "account", name: "Account", icon: "prof" },
    { id: "about", name: "About", icon: "doc" },
]

/** The wallet the copy names: Adena, unless Base (another wallet) can be selected too. */
const WALLET = EVM_ENABLED ? "your wallet" : "Adena"

/** Validator and GovDAO alerts (gnomonitoring), loaded when Notifications opens. */
const AlertsPanel = lazy(() => import("../../../components/alerts/AlertsPanel"))
/** The classic /alerts page opens Notifications, where the alerts live. */
const SECTION_ALIASES: Readonly<Record<string, string>> = { alerts: "notifications" }

function ResetSheet({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
    const dialogRef = useRef<HTMLDialogElement>(null)
    const cancelRef = useRef<HTMLButtonElement>(null)
    useEffect(() => {
        const dialog = dialogRef.current
        dialog?.showModal()
        cancelRef.current?.focus()
        return () => { if (dialog?.open) dialog.close() }
    }, [])
    return <dialog ref={dialogRef} className="os-set-dialog os-glass" aria-modal="true" aria-label="Reset local app data"
        onCancel={(event) => { event.preventDefault(); onCancel() }}>
            <h3>Reset local app data?</h3>
            <p>This closes other open windows and resets desktop layout, appearance, gas defaults, network preference and cached names on this device. Settings stays open.</p>
            <p><strong>Kept:</strong> unsent DAO and Terminal drafts, saved recipients, send locks, wallet sessions and on-chain data.</p>
            <div className="os-set-actions">
                <button ref={cancelRef} type="button" className="os-btn os-quiet" onClick={onCancel}>Cancel</button>
                <button type="button" className="os-btn" onClick={onConfirm}>Confirm reset</button>
            </div>
    </dialog>
}

function readRawGas(): string | null {
    try { return localStorage.getItem("memba_settings") } catch { return null }
}

function gasFields() {
    const config = getGasConfig()
    return { wanted: String(config.wanted), fee: String(config.fee) }
}

export default function SettingsWindow({ section: asked, session, open, openApp, fallback }: NativeViewProps) {
    const section = asked !== null ? SECTION_ALIASES[asked] ?? asked : null
    const current = sections.some(({ id }) => id === section) ? section! : "desktop"
    // A pane is the window's own address (/os/settings/<pane>), so a link that opens
    // a pane (the Validators app's Alerts button) shows it even after the user moved on.
    const setCurrent = (next: string) => open(specForTarget({ kind: "app", app: "settings", section: next })!)
    const appearance = useOsAppearance()
    const liveWidget = useLiveWidget()
    const skipIntro = useSkipIntro()
    const [confirmReset, setConfirmReset] = useState(false)
    const [resetStatus, setResetStatus] = useState("")
    const [gas, setGas] = useState(gasFields)
    const [gasStatus, setGasStatus] = useState("")
    const [gasErrors, setGasErrors] = useState({ wanted: "", fee: "" })
    const [gasDirty, setGasDirty] = useState(false)
    const [gasConflict, setGasConflict] = useState(false)
    const gasSource = useRef(readRawGas())
    const gasWantedRef = useRef<HTMLInputElement>(null)
    const gasFeeRef = useRef<HTMLInputElement>(null)
    const resetTrigger = useRef<HTMLButtonElement>(null)
    const networks = selectableOsNetworks()

    const reloadGas = useCallback(() => {
        gasSource.current = readRawGas()
        setGas(gasFields())
        setGasDirty(false)
        setGasConflict(false)
        setGasErrors({ wanted: "", fee: "" })
        setGasStatus("")
    }, [])
    useEffect(() => {
        const changed = (event: StorageEvent) => {
            if (event.key !== null && event.key !== "memba_settings") return
            if (gasDirty) setGasConflict(true)
            else reloadGas()
        }
        window.addEventListener("storage", changed)
        return () => window.removeEventListener("storage", changed)
    }, [gasDirty, reloadGas])

    const closeReset = () => {
        setConfirmReset(false)
        requestAnimationFrame(() => resetTrigger.current?.focus())
    }
    const reset = () => {
        try {
            const count = resetLocalUiData(localStorage)
            appearance.reset()
            setLiveWidget(false)
            setSkipIntro(false)
            reloadGas()
            window.dispatchEvent(new Event("memba-os-local-ui-reset"))
            setResetStatus(`Local app data reset (${count} saved items removed). Drafts and send locks were kept.`)
        } catch {
            setResetStatus("Local storage interrupted the reset. Some preferences may have been removed; check them before trying again. No wallet or on-chain data was changed.")
        }
        closeReset()
    }
    const saveGas = () => {
        const gasWanted = parseDefaultGasInput(gas.wanted, MAX_DEFAULT_GAS_WANTED)
        const gasFee = parseDefaultGasInput(gas.fee, MAX_DEFAULT_GAS_FEE_UGNOT)
        const errors = {
            wanted: gasWanted === null ? `Enter a whole number from 1 to ${MAX_DEFAULT_GAS_WANTED.toLocaleString("en-US")}.` : "",
            fee: gasFee === null ? `Enter a whole number from 1 to ${MAX_DEFAULT_GAS_FEE_UGNOT.toLocaleString("en-US")} ugnot (10 GNOT).` : "",
        }
        setGasErrors(errors)
        if (gasWanted === null || gasFee === null) {
            setGasStatus("Correct the highlighted gas default before saving.")
            ;(gasWanted === null ? gasWantedRef : gasFeeRef).current?.focus()
            return
        }
        try {
            if (gasConflict || readRawGas() !== gasSource.current) {
                setGasConflict(true)
                setGasStatus("Gas defaults changed elsewhere. Load the latest values before saving.")
                return
            }
            const saved = JSON.stringify({ gasWanted, gasFee })
            localStorage.setItem("memba_settings", saved)
            gasSource.current = saved
            setGasDirty(false)
            setGasStatus("Gas defaults saved on this device. Review each transaction before signing.")
        } catch { setGasStatus("This browser could not save gas defaults.") }
    }

    if (section !== null && !sections.some(({ id }) => id === section)) return fallback
    const feeValue = parseDefaultGasInput(gas.fee, MAX_DEFAULT_GAS_FEE_UGNOT)
    const feeGnot = feeValue === null ? null : (feeValue / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 6 })

    return <AppShell label="Settings" sections={sections} current={current} onSelect={setCurrent}>
        <div className="os-settings">
            {current === "desktop" && <>
                <header><h2>Desktop</h2><p className="os-sub">Make this workspace yours. These choices stay on this device.</p></header>
                <div className="os-set-card">
                    <h3>Appearance</h3>
                    <p className="os-sub">System follows your device theme; Light and Dark keep a fixed appearance.</p>
                    <div className="os-set-choice" role="group" aria-label="Appearance">
                        {(["auto", "light", "dark"] as const).map((value) => <button key={value} type="button" aria-pressed={appearance.themePref === value}
                            onClick={() => appearance.setThemePref(value)}>{value === "auto" ? "System" : value === "light" ? "Light" : "Dark"}</button>)}
                    </div>
                </div>
                <div className="os-set-card">
                    <h3>Wallpaper</h3>
                    <p className="os-sub">Each wallpaper has a light and dark version.</p>
                    <div className="os-set-wallpapers" role="group" aria-label="Wallpaper">
                        {WALLPAPERS.map((wallpaper) => <button key={wallpaper.id} type="button" aria-label={`${wallpaper.name} wallpaper`}
                            aria-pressed={appearance.wallpaper.id === wallpaper.id} onClick={() => appearance.setWallpaperId(wallpaper.id)}>
                            <span aria-hidden="true" className="os-set-preview" style={{ background: appearance.theme === "dark" ? wallpaper.dark : wallpaper.light }} />
                            <span>{wallpaper.name}</span>
                        </button>)}
                    </div>
                </div>
                <div className="os-set-card">
                    <h3>Desktop icons</h3>
                    <p className="os-sub">Change the size of desktop tiles. Phone home icons keep their own size.</p>
                    <div className="os-set-choice" role="group" aria-label="Desktop icon size">
                        {(["small", "medium", "large"] as OsIconSize[]).map((value) => <button key={value} type="button" aria-label={`${value[0].toUpperCase()}${value.slice(1)} icons`}
                            aria-pressed={appearance.iconSize === value} onClick={() => appearance.setIconSize(value)}>{value[0].toUpperCase()}{value.slice(1)}</button>)}
                    </div>
                </div>
                <div className="os-set-card">
                    <h3>Live activity</h3>
                    <p className="os-sub">Hover or focus the network in the menu bar to check Live activity. Add the widget if you also want it on your desktop.</p>
                    <label className="os-set-toggle"><input type="checkbox" checked={liveWidget} onChange={(event) => setLiveWidget(event.target.checked)} />Add the Widget</label>
                </div>
                <div className="os-set-card">
                    <h3>Welcome screen</h3>
                    <p className="os-sub">By default, the introduction and Connect or Guest choice appear each time you open Memba OS. Direct links open their content immediately.</p>
                    <label className="os-set-toggle"><input type="checkbox" checked={skipIntro} onChange={(event) => setSkipIntro(event.target.checked)} />Skip intro automatically</label>
                </div>
            </>}
            {current === "notifications" && <>
                <header><h2>Notifications</h2><p className="os-sub">Signing and transaction status appears in the menu-bar bell or phone notification sheet while this session is open.</p></header>
                <div className="os-set-card"><h3>Delivery</h3><p>Feed replies appear in Feed. Browser and email notification controls are not available in this beta.</p></div>
                <div className="os-set-card"><h3>Validators and GovDAO alerts</h3>
                    <Suspense fallback={<p className="os-sub" role="status">Loading alerts…</p>}><AlertsPanel embedded /></Suspense>
                </div>
            </>}
            {current === "safety" && <>
                <header><h2>Safety</h2><p className="os-sub">Local data controls affect only this browser.</p></header>
                <div className="os-set-card"><h3>Before you sign</h3><p>Check the transaction details Memba shows, then verify the account, network and gas in {WALLET} before approving. Memba never changes on-chain data from Settings.</p></div>
                <div className="os-set-card"><h3>Reset local app data</h3><p>Close other open windows and reset desktop layout, appearance, gas defaults and cached names. Unsent drafts and send locks remain saved.</p>
                    <button ref={resetTrigger} type="button" className="os-btn os-quiet" onClick={() => { setResetStatus(""); setConfirmReset(true) }}>Reset local app data</button>
                    {resetStatus && <p role="status" className="os-note">{resetStatus}</p>}
                </div>
            </>}
            {current === "network" && <>
                <header><h2>Network</h2><p className="os-sub">Settings shows the network selected for Memba OS. Switching reloads this page and may require reconnecting {WALLET}.</p></header>
                <dl className="os-set-details os-set-card"><dt>Selected network</dt><dd>{session.network.label}</dd><dt>Chain ID</dt><dd className="os-mono">{session.network.chainId}</dd><dt>Configured primary RPC</dt><dd className="os-mono">{session.network.rpcHost}</dd></dl>
                {networks.length > 1 ? <div className="os-set-card"><h3>Switch network</h3><p className="os-sub">Check the selected chain in {WALLET} before signing after a switch.</p><div className="os-set-choice">{networks.map((network) => <button type="button" key={network.key} className="os-btn os-quiet" disabled={network.key === session.network.key} onClick={() => switchOsNetwork(network.key)}>{network.key === session.network.key ? `${network.label} (selected)` : `Switch to ${network.label}`}</button>)}</div></div>
                    : <p className="os-note">Only {session.network.label} is available in this build.</p>}
            </>}
            {current === "transactions" && <>
                <header><h2>Transactions</h2><p className="os-sub">Defaults are stored on this device. A transaction's own estimate or review can override them.</p></header>
                <div className="os-set-card os-set-form">
                    <label htmlFor="os-settings-gas-wanted">Gas wanted</label>
                    <input ref={gasWantedRef} id="os-settings-gas-wanted" type="number" min="1" max={MAX_DEFAULT_GAS_WANTED} step="1" value={gas.wanted} aria-invalid={!!gasErrors.wanted} aria-describedby={`os-settings-gas-wanted-help${gasErrors.wanted ? " os-settings-gas-wanted-error" : ""}`} onChange={(event) => { setGas((value) => ({ ...value, wanted: event.target.value })); setGasDirty(true); setGasErrors((value) => ({ ...value, wanted: "" })); setGasStatus("") }} />
                    <p id="os-settings-gas-wanted-help" className="os-sub">Maximum {MAX_DEFAULT_GAS_WANTED.toLocaleString("en-US")} gas; deploys may use five times this default.</p>
                    {gasErrors.wanted && <p id="os-settings-gas-wanted-error" className="os-note os-err">{gasErrors.wanted}</p>}
                    <label htmlFor="os-settings-gas-fee">Gas fee (ugnot)</label>
                    <input ref={gasFeeRef} id="os-settings-gas-fee" type="number" min="1" max={MAX_DEFAULT_GAS_FEE_UGNOT} step="1" value={gas.fee} aria-invalid={!!gasErrors.fee} aria-describedby={`os-settings-gas-fee-help${gasErrors.fee ? " os-settings-gas-fee-error" : ""}`} onChange={(event) => { setGas((value) => ({ ...value, fee: event.target.value })); setGasDirty(true); setGasErrors((value) => ({ ...value, fee: "" })); setGasStatus("") }} />
                    <p id="os-settings-gas-fee-help" className="os-sub">1 GNOT = 1,000,000 ugnot. {feeGnot === null ? "" : `This is ${feeGnot} GNOT. `}Maximum default: 10 GNOT.</p>
                    {gasErrors.fee && <p id="os-settings-gas-fee-error" className="os-note os-err">{gasErrors.fee}</p>}
                    <button type="button" className="os-btn" onClick={saveGas}>Save gas defaults</button>
                    {gasConflict && <button type="button" className="os-btn os-quiet" onClick={reloadGas}>Load latest gas defaults</button>}
                    {gasStatus && <p role={gasStatus.startsWith("Gas defaults saved") ? "status" : "alert"} className="os-note">{gasStatus}</p>}
                </div>
            </>}
            {current === "account" && <>
                <header><h2>Account</h2><p className="os-sub">Your wallet connects to Memba when you choose an action that needs it.</p></header>
                <div className="os-set-card">
                    {session.status === "member" ? <><h3>Connected account</h3><p className="os-mono os-set-address">{session.address}</p></> : <><h3>Browsing as a guest</h3><p>You can read public information without a wallet. Connect when you want to post, vote or sign.</p><button type="button" className="os-btn" onClick={session.openConnect}>Connect wallet</button></>}
                    {session.status === "member" && <button type="button" className="os-btn os-quiet" onClick={() => openApp("profile")}>Open Profile</button>}
                </div>
            </>}
            {current === "about" && <>
                <header><h2>About</h2><p className="os-sub">Memba OS is an experimental public beta.</p></header>
                <div className="os-set-card"><p>Memba v{APP_VERSION} · {session.network.chainId}</p><button type="button" className="os-btn" onClick={() => open(specForTarget({ kind: "about" })!)}>Open About Memba OS</button></div>
            </>}
            {confirmReset && <ResetSheet onCancel={closeReset} onConfirm={reset} />}
        </div>
    </AppShell>
}
