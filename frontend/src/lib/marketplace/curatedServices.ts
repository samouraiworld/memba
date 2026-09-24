/**
 * curatedServices.ts — the Services lane's curated listings.
 *
 * Curated entries are reviewed code changes: each one is added, edited or
 * removed only through a pull request, never from runtime data. A listing has
 * no fixed price and no fixed milestones: its Hire button opens the Hire by
 * address form with the freelancer locked to the listed address, and the
 * client writes the milestones and amounts agreed with the freelancer. The
 * realm checks everything else when the contract is created.
 *
 * Shown wherever the Services lane is live (VITE_ENABLE_SERVICES and the
 * escrow realm allowlisted on the network): a gno.land address is the same on
 * every chain, so the same listing is valid on mainnet and test networks.
 */

export interface CuratedService {
    /** Stable id (a slug). */
    id: string
    title: string
    category: string
    description: string
    /** The freelancer's address: the one the Hire form locks. */
    freelancer: string
    /** Editable starting value of the contract title. */
    titlePrefix: string
}

export const CURATED_SERVICES: readonly CuratedService[] = [
    {
        id: "samourai-coop-dev",
        title: "Samourai Coop — dev services",
        category: "Development",
        description: "Gno realm and dApp development, audits and integrations by the Samourai Coop team. Scope and milestones are agreed per project.",
        freelancer: "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c",
        titlePrefix: "Samourai Coop — ",
    },
]
