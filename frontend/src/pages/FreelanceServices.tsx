/**
 * FreelanceServices — Freelance & Services marketplace page.
 *
 * Phase 4c: Browse services, hire freelancers with milestone-based escrow.
 * Route: /services
 *
 * @module pages/FreelanceServices
 */

import { useState, useEffect, useMemo, useDeferredValue } from "react"
import { ArrowRight } from "@phosphor-icons/react"
import {
    searchListings,
    SERVICE_CATEGORIES,
    type ServiceListing,
    type ServiceCategory,
} from "../lib/escrowTemplate"
import { ComingSoonGate } from "../components/ui/ComingSoonGate"
import "./freelance.css"

const SERVICES_ENABLED = import.meta.env.VITE_ENABLE_SERVICES === "true"

export default function FreelanceServices() {
    if (!SERVICES_ENABLED) {
        return (
            <ComingSoonGate
                title="Freelance Services"
                icon="💼"
                description="Hire experts with milestone-based escrow contracts on gno.land."
                features={[
                    "On-chain escrow contracts for freelance work",
                    "DAO-to-contributor matching",
                    "Milestone-based payment releases",
                    "Dispute resolution via DAO governance",
                ]}
            />
        )
    }

    return <FreelanceServicesContent />
}

function FreelanceServicesContent() {
    const [search, setSearch] = useState("")
    const deferredSearch = useDeferredValue(search)
    const [category, setCategory] = useState<ServiceCategory | "all">("all")
    const [selectedService, setSelectedService] = useState<ServiceListing | null>(null)
    const [hireNotice, setHireNotice] = useState(false)

    useEffect(() => { document.title = "Freelance Services — Memba" }, [])

    const listings = useMemo(() =>
        searchListings(deferredSearch, category === "all" ? undefined : category),
        [deferredSearch, category],
    )

    // ── Service Detail View ──────────────────────────────────
    if (selectedService) {
        return (
            <div className="fl-page animate-fade-in">
                <button className="fl-back" onClick={() => setSelectedService(null)}>
                    ← Back to Services
                </button>

                <div className="fl-detail">
                    <div className="fl-detail__header">
                        <h1 className="fl-detail__title">{selectedService.title}</h1>
                        <div className="fl-detail__meta">
                            <span>by {selectedService.sellerName || selectedService.seller.slice(0, 10) + "..."}</span>
                            <span>{selectedService.completedJobs} jobs completed</span>
                            {selectedService.rating > 0 && (
                                <span className="fl-rating">★ {selectedService.rating.toFixed(1)} ({selectedService.ratingCount})</span>
                            )}
                        </div>
                    </div>

                    <p className="fl-detail__desc">{selectedService.description}</p>

                    {/* Pricing */}
                    <div className="fl-detail__section">
                        <h3>Pricing</h3>
                        <div className="fl-price-card">
                            <div className="fl-price-card__amount">
                                {(selectedService.price / 1_000_000).toFixed(1)} GNOT
                            </div>
                            <div className="fl-price-card__ugnot">
                                ({selectedService.price.toLocaleString()} ugnot)
                            </div>
                            <div className="fl-price-card__delivery">
                                Delivery: ~{Math.round(selectedService.deliveryBlocks / 28800)} days
                            </div>
                        </div>
                    </div>

                    {/* Escrow flow */}
                    <div className="fl-detail__section">
                        <h3>How Escrow Works</h3>
                        <div className="fl-flow">
                            <div className="fl-flow__step">
                                <span className="fl-flow__num">1</span>
                                <div>
                                    <strong>Create Contract</strong>
                                    <p>Define milestones and deliverables with the freelancer</p>
                                </div>
                            </div>
                            <div className="fl-flow__step">
                                <span className="fl-flow__num">2</span>
                                <div>
                                    <strong>Fund Milestones</strong>
                                    <p>Deposit GNOT into escrow for each milestone</p>
                                </div>
                            </div>
                            <div className="fl-flow__step">
                                <span className="fl-flow__num">3</span>
                                <div>
                                    <strong>Deliver & Release</strong>
                                    <p>Freelancer completes work, you release funds</p>
                                </div>
                            </div>
                            <div className="fl-flow__step">
                                <span className="fl-flow__num">4</span>
                                <div>
                                    <strong>Dispute Resolution</strong>
                                    <p>If needed, raise a dispute for admin arbitration</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Tags */}
                    <div className="fl-detail__tags">
                        {selectedService.tags.map(t => (
                            <span key={t} className="fl-tag">{t}</span>
                        ))}
                    </div>

                    <button
                        className="fl-hire-btn"
                        onClick={() => setHireNotice(true)}
                    >
                        Hire Freelancer →
                    </button>
                    {hireNotice && (
                        <div className="fl-notice">
                            <p>Escrow contracts are coming soon. Connect your wallet and deploy the escrow realm to start hiring freelancers on-chain.</p>
                            <button className="fl-notice__dismiss" onClick={() => setHireNotice(false)}>Got it</button>
                        </div>
                    )}
                </div>
            </div>
        )
    }

    // ── Services Grid ────────────────────────────────────────
    return (
        <div className="fl-page animate-fade-in">
            <div className="fl-header">
                <div>
                    <h1>💼 Freelance Services</h1>
                    <p>Hire experts with milestone-based escrow on gno.land</p>
                </div>
            </div>

            <input
                type="text"
                placeholder="Search services..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="fl-search"
                aria-label="Search freelance services"
            />

            <div className="fl-categories">
                <button className="fl-cat-pill" data-active={category === "all"} onClick={() => setCategory("all")}>
                    All
                </button>
                {SERVICE_CATEGORIES.map(c => (
                    <button key={c.key} className="fl-cat-pill" data-active={category === c.key} onClick={() => setCategory(c.key)}>
                        {c.icon} {c.label}
                    </button>
                ))}
            </div>

            <div className="fl-count">
                {listings.length} service{listings.length !== 1 ? "s" : ""} found
            </div>

            {listings.length === 0 ? (
                <div className="fl-empty">
                    <span className="fl-empty__icon">💼</span>
                    <p>No services found{search ? ` matching "${search}"` : ""}</p>
                </div>
            ) : (
                <div className="fl-grid">
                    {listings.map(service => (
                        <button key={service.id} className="fl-card" onClick={() => setSelectedService(service)}>
                            <div className="fl-card__top">
                                <span className="fl-card__icon">
                                    {SERVICE_CATEGORIES.find(c => c.key === service.category)?.icon || "💼"}
                                </span>
                                <div className="fl-card__header">
                                    <div className="fl-card__title">{service.title}</div>
                                    <div className="fl-card__seller">
                                        by {service.sellerName || service.seller.slice(0, 10) + "..."}
                                    </div>
                                </div>
                            </div>
                            <p className="fl-card__desc">{service.description}</p>
                            <div className="fl-card__footer">
                                <span className="fl-card__price">
                                    {(service.price / 1_000_000).toFixed(1)} GNOT
                                </span>
                                {service.rating > 0 && (
                                    <span className="fl-card__rating">★ {service.rating.toFixed(1)}</span>
                                )}
                                <span className="fl-card__jobs">{service.completedJobs} jobs</span>
                                <ArrowRight size={14} className="fl-card__arrow" />
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
