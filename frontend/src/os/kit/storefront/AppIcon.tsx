import { useState, type CSSProperties } from "react"
import { monogram } from "./monogram"

function Icon({ name, logo, accent, size }: { name: string; logo: string | null; accent: string; size: number }) {
    const [failed, setFailed] = useState(false)
    return <span className="os-cin-icon" style={{ "--icon-accent": accent, "--icon-size": `${size}px` } as CSSProperties} aria-hidden="true">
        {logo && !failed ? <img src={logo} alt="" loading="lazy" onError={() => setFailed(true)} /> : monogram(name)}
    </span>
}

/** A logo, or a monogram on the entry's accent. Keyed by logo so a new logo gets a fresh error state. */
export function AppIcon({ name, logo, accent, size = 56 }: { name: string; logo: string | null; accent: string; size?: number }) {
    return <Icon key={logo ?? ""} name={name} logo={logo} accent={accent} size={size} />
}
