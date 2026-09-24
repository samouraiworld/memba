import { useClock } from "./clock"

/** First-visit lock screen (D7). Also shown after "Lock screen" / "Disconnect & lock". */
export function LockScreen({ onConnect, onGuest }: { onConnect: () => void; onGuest: () => void }) {
    const [time, date] = useClock()
    return (
        <div className="os-lock" role="dialog" aria-modal="true" aria-label="Welcome to Memba">
            <div>
                <span className="os-mark os-mark-lg" aria-hidden="true" />
                <div className="os-lock-clock">{time}</div>
                <div className="os-lock-tag">Memba — your desk on gno.land</div>
                <div className="os-lock-date">{date}</div>
                <div className="os-lock-acts">
                    <button type="button" className="os-lock-primary" onClick={onConnect} autoFocus>Connect wallet</button>
                    <button type="button" className="os-lock-secondary" onClick={onGuest}>Continue as guest</button>
                </div>
                <div className="os-lock-hint">Guests can open and read everything. You'll only see this screen once.</div>
            </div>
        </div>
    )
}
