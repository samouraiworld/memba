import type { ReactNode } from "react"

export function InfoRows({ rows }: { rows: readonly (readonly [string, ReactNode])[] }) {
    return <dl className="os-cin-info">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
}
