import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { APP_VERSION } from "../../../lib/config"
import { getGasConfig } from "../../../lib/gasConfig"
import { useOsAppearance, type OsIconSize } from "../../appearance"
import { AppShell, type ShellSection } from "../../kit"
import type { NativeViewProps } from "../../native/types"
import { specForTarget } from "../../shell/windows"
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

const MAX_GAS_WANTED = Math.floor(Number.MAX_SAFE_INTEGER / 5)

function validGas(value: string, max = Number.MAX_SAFE_INTEGER): number | null {
    if (!/^[1-9]\d*$/.test(value)) return null
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) && parsed <= max ? parsed : null
}

function ResetSheet({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
    const cancelRef = useRef<HTMLButtonElement>(null)
    useEffect(() => { cancelRef.current?.focus() }, [])
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") { event.preventDefault(); onCancel() }
        if (event.key !== "Tab") return
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"))
        if (buttons.length === 0) return
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1].focus() }
        else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0].focus() }
    }
    return <div className="os-set-overlay">
        <div className="os-set-dialog os-glass" role="dialog" aria-modal="true" aria-label="Reset local app data" onKeyDown={onKeyDown}>
            <h3>Reset local app data?</h3>
            <p>This resets desktop layout, open windows, appearance, gas defaults, network preference and cached names on this device. The current page stays open until you revisit it.</p>
            <p><strong>Kept:</strong> unsent DAO and Terminal drafts, saved recipients, send locks, wallet sessions and on-chain data.</p>
            <div className="os-set-actions">
                <button ref={cancelRef} type="button" className="os-btn os-quiet" onClick={onCancel}>Cancel</button>
                <button type="button" className="os-btn" onClick={onConfirm}>Confirm reset</button>
            </div>
        </div>
    </div>
}

export default function SettingsWindow({ section, session, open, openApp }: NativeViewProps) {
    const initial = sections.some(({ id }) => id === section) ? section! : "desktop"
    const [current, setCurrent] = useState(initial)
    const appearance = useOsAppearance()
    const [confirmReset, setConfirmReset] = useState(false)
    const [resetStatus, setResetStatus] = useState("")
    const [gas, setGas] = useState(() => {
        const config = getGasConfig()
        return { wanted: String(config.wanted), fee: String(config.fee) }
    })
    const [gasStatus, setGasStatus] = useState("")
    const resetTrigger = useRef<HTMLButtonElement>(null)

    const closeReset = () => { setConfirmReset(false); resetTrigger.current?.focus() }
    const reset = () => {
        try {
            const count = resetLocalUiData(localStorage)
            appearance.reset()
            const config = getGasConfig()
            setGas({ wanted: String(config.wanted), fee: String(config.fee) })
            setResetStatus(`Local app data reset (${count} saved items removed). Drafts and send locks were kept.`)
        } catch {
            setResetStatus("Local storage refused the reset. No wallet or on-chain data was changed.")
        }
        closeReset()
    }
    const saveGas = () => {
        const gasWanted = validGas(gas.wanted, MAX_GAS_WANTED)
        const gasFee = validGas(gas.fee)
        if (gasWanted === null || gasFee === null) {
            setGasStatus("Gas wanted and gas fee must be positive whole numbers; gas wanted must keep the deploy limit within the safe integer range.")
            return
        }
        try {
            localStorage.setItem("memba_settings", JSON.stringify({ gasWanted, gasFee }))
            setGasStatus("Gas defaults saved on this device. Review each transaction before signing.")
        } catch { setGasStatus("This browser could not save gas defaults.") }
    }

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
            </>}
            {current === "notifications" && <>
                <header><h2>Notifications</h2><p className="os-sub">Recent Memba alerts appear in the menu-bar bell, or the phone notification sheet.</p></header>
                <div className="os-set-card"><h3>Delivery</h3><p>Memba currently shows alerts inside the app. Browser and email notification controls are not available in this beta.</p></div>
            </>}
            {current === "safety" && <>
                <header><h2>Safety</h2><p className="os-sub">Local data controls affect only this browser.</p></header>
                <div className="os-set-card"><h3>Before you sign</h3><p>Check the selected chain, account, recipient, amount and gas in the review shown for each transaction. Memba never changes on-chain data from Settings.</p></div>
                <div className="os-set-card"><h3>Reset local app data</h3><p>Reset open windows, desktop layout, appearance, gas defaults and cached names. Unsent drafts and send locks remain saved.</p>
                    <button ref={resetTrigger} type="button" className="os-btn os-quiet" onClick={() => { setResetStatus(""); setConfirmReset(true) }}>Reset local app data</button>
                    {resetStatus && <p role="status" className="os-note">{resetStatus}</p>}
                </div>
            </>}
            {current === "network" && <>
                <header><h2>Network</h2><p className="os-sub">The menu bar owns network switching for every OS app.</p></header>
                <dl className="os-set-details os-set-card"><dt>Selected network</dt><dd>{session.network.label}</dd><dt>Chain ID</dt><dd className="os-mono">{session.network.chainId}</dd><dt>RPC host</dt><dd className="os-mono">{session.network.rpcHost}</dd></dl>
            </>}
            {current === "transactions" && <>
                <header><h2>Transactions</h2><p className="os-sub">Defaults are stored on this device. A transaction's own estimate or review can override them.</p></header>
                <div className="os-set-card os-set-form">
                    <label htmlFor="os-settings-gas-wanted">Gas wanted</label>
                    <input id="os-settings-gas-wanted" type="number" min="1" step="1" value={gas.wanted} onChange={(event) => { setGas((value) => ({ ...value, wanted: event.target.value })); setGasStatus("") }} />
                    <label htmlFor="os-settings-gas-fee">Gas fee (ugnot)</label>
                    <input id="os-settings-gas-fee" type="number" min="1" step="1" value={gas.fee} onChange={(event) => { setGas((value) => ({ ...value, fee: event.target.value })); setGasStatus("") }} />
                    <button type="button" className="os-btn" onClick={saveGas}>Save gas defaults</button>
                    {gasStatus && <p role={gasStatus.startsWith("Gas wanted") || gasStatus.startsWith("This browser") ? "alert" : "status"} className="os-note">{gasStatus}</p>}
                </div>
            </>}
            {current === "account" && <>
                <header><h2>Account</h2><p className="os-sub">Your wallet connects to Memba when you choose an action that needs it.</p></header>
                <div className="os-set-card">
                    {session.status === "member" ? <><h3>Connected account</h3><p className="os-mono os-set-address">{session.address}</p></> : <><h3>Browsing as a guest</h3><p>You can read public information without a wallet. Connect when you want to post, vote or sign.</p><button type="button" className="os-btn" onClick={session.openConnect}>Connect wallet</button></>}
                    <button type="button" className="os-btn os-quiet" onClick={() => openApp("profile")}>Open Profile</button>
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
