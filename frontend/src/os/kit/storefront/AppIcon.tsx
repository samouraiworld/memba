import { useState, type CSSProperties } from "react"
import { monogram } from "./monogram"

interface IconProps { name: string; logo: string | null; accent: string; logoBackground?: string; size: number }

function Icon({ name, logo, accent, logoBackground, size }: IconProps) {
    const [failed, setFailed] = useState(false)
    const framed = !!logo && !failed && !!logoBackground
    return <span className="os-cin-icon" data-framed={framed || undefined} style={{ "--icon-accent": framed ? logoBackground : accent, "--icon-size": `${size}px` } as CSSProperties} aria-hidden="true">
        {logo && !failed ? <img src={logo} alt="" loading="lazy" onError={() => setFailed(true)} /> : monogram(name)}
    </span>
}

/** A logo, or a monogram on the entry's accent. Keyed by logo so a new logo gets a fresh error state. */
export function AppIcon({ size = 56, ...props }: Omit<IconProps, "size"> & { size?: number }) {
    return <Icon key={props.logo ?? ""} {...props} size={size} />
}
