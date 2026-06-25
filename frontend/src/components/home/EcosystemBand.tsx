/**
 * EcosystemBand — below-the-fold "ecosystem at a glance" KPI tiles.
 *
 * Reads the server home snapshot (useHomeSnapshot.counts — real once B1/#528 is
 * deployed). Honesty: a tile is shown ONLY when its count is a real, >0 value;
 * if no count is available the whole band renders nothing (never a row of 0/—).
 * DAOs and collections are intentionally omitted (no honest network-wide DAO
 * count source yet; collections is the gated-off NFT surface).
 *
 * @module components/home/EcosystemBand
 */
import { useHomeSnapshot } from "../../hooks/home/useHomeSnapshot"
import "./home.css"

interface Tile {
    key: string
    label: string
    value: number
}

export function EcosystemBand() {
    const { snapshot, usable } = useHomeSnapshot()
    const counts = usable ? snapshot?.counts : undefined

    const tiles: Tile[] = [
        { key: "tokens", label: "tokens", value: counts?.tokens },
        { key: "agents", label: "agents", value: counts?.agents },
        { key: "validators", label: "validators", value: counts?.validators },
    ].filter((t): t is Tile => typeof t.value === "number" && t.value > 0)

    if (tiles.length === 0) return null

    return (
        <section className="ecosystem-band" data-testid="ecosystem-band">
            <div className="below-fold__eyebrow">ecosystem at a glance</div>
            <div className="ecosystem-band__tiles">
                {tiles.map((t) => (
                    <div key={t.key} className="ecosystem-tile" data-testid={`eco-${t.key}`}>
                        <span className="ecosystem-tile__value">{t.value}</span>
                        <span className="ecosystem-tile__label">{t.label}</span>
                    </div>
                ))}
            </div>
        </section>
    )
}
