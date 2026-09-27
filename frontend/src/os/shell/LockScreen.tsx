import { useRef, type KeyboardEvent } from "react"
import { useClock } from "./clock"

/** Visit choice. Also shown after "Lock screen" / "Disconnect & lock". */
export function LockScreen({ onConnect, onGuest, resuming = false }: { onConnect: () => void; onGuest: () => void; resuming?: boolean }) {
    const [time, date] = useClock()
    const connect = useRef<HTMLButtonElement>(null)
    const guest = useRef<HTMLButtonElement>(null)
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== "Tab") return
        if (e.shiftKey && document.activeElement === connect.current) {
            e.preventDefault()
            guest.current?.focus()
        } else if (!e.shiftKey && document.activeElement === guest.current) {
            e.preventDefault()
            connect.current?.focus()
        }
    }
    return (
        <div className="os-lock" role="dialog" aria-modal="true" aria-label="Welcome to Memba" onKeyDown={onKeyDown}>
            <div>
                <span className="os-mark os-mark-lg" aria-hidden="true" />
                <div className="os-lock-clock">{time}</div>
                <div className="os-lock-tag">Memba — your desk on gno.land</div>
                <div className="os-lock-date">{date}</div>
                <div className="os-lock-acts">
                    <button ref={connect} type="button" className="os-lock-primary" onClick={onConnect} disabled={resuming} autoFocus>{resuming ? "Resuming wallet…" : "Connect wallet"}</button>
                    <button ref={guest} type="button" className="os-lock-secondary" onClick={onGuest}>Continue as guest</button>
                </div>
                <div className="os-lock-hint">Guests can explore public apps, DAOs and posts. Connect for private accounts or on-chain actions. You can skip this screen in Settings or return here from the Memba menu.</div>
            </div>
        </div>
    )
}
