/**
 * CuratedServiceCard — one curated Services listing (lib/marketplace/curatedServices.ts).
 * No price and no fixed milestones: "Quote per project", and Hire opens the
 * Hire by address form with the listing's freelancer locked.
 */
import type { CuratedService } from "../../lib/marketplace/curatedServices"
import { SignedAddress } from "../ui/SigningValue"
import "./escrow.css"

export function CuratedServiceCard({ service, disabled, onHire }: { service: CuratedService; disabled: boolean; onHire: () => void }) {
    return (
        <article className="k-card escrow-curated" data-testid={`curated-service-${service.id}`}>
            <div className="escrow-curated-head">
                <h3 style={{ margin: 0, fontSize: "18px", color: "var(--color-text)" }}>{service.title}</h3>
                <span className="escrow-status">{service.category}</span>
            </div>
            <span className="escrow-badge">Curated by Memba</span>
            <p style={{ fontSize: "14px", color: "var(--color-text-muted)", margin: "12px 0", lineHeight: 1.5 }}>{service.description}</p>
            <dl className="escrow-grid" style={{ margin: "0 0 12px" }}>
                <dt>Freelancer</dt>
                <dd><SignedAddress value={service.freelancer} /></dd>
                <dt>Price</dt>
                <dd data-testid="curated-price">Quote per project</dd>
            </dl>
            <button className="k-btn-primary" style={{ width: "100%" }} onClick={onHire} disabled={disabled} aria-label={`Hire: ${service.title}`}>
                Hire
            </button>
        </article>
    )
}
