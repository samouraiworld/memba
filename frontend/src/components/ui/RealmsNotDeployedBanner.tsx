/**
 * RealmsNotDeployedBanner — honest notice for networks where Memba's own realms
 * are not deployed yet.
 *
 * A network can be official and reachable (e.g. test13 at the official-testnet
 * cutover) while Memba's contracts (memba_dao, channels_v2, agent_registry, …)
 * are not yet deployed there. Without this notice the DAO/channel pages would
 * silently 404. The `deployed` flag comes from `areRealmsDeployed()` (config),
 * so this banner disappears automatically once the realms are deployed and the
 * network's `realmsDeployed` flag flips.
 */

interface RealmsNotDeployedBannerProps {
    /** Whether Memba's realms are deployed on the active network. */
    deployed: boolean
    /** Human-readable label of the active network (e.g. "Testnet 13"). */
    networkLabel: string
    /**
     * Community features whose realm is not usable on this network. When given,
     * the notice names only these, and renders nothing if the list is empty, so
     * a partial rollout (e.g. feed and quests live, channels not yet) is not
     * reported as "nothing is here".
     */
    missing?: readonly string[]
}

const DEFAULT_MISSING = ["channels", "candidature", "feed", "quests"] as const

function listFeatures(items: readonly string[]): string {
    if (items.length <= 1) return items.join("")
    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

export function RealmsNotDeployedBanner({ deployed, networkLabel, missing = DEFAULT_MISSING }: RealmsNotDeployedBannerProps) {
    if (deployed || missing.length === 0) return null

    return (
        <div
            role="status"
            style={{
                background: "var(--realm-banner-bg, linear-gradient(135deg, rgba(33,150,243,0.15), rgba(63,81,181,0.12)))",
                border: "var(--realm-banner-border, 1px solid rgba(33,150,243,0.35))",
                borderRadius: "var(--radius-md, 10px)",
                padding: "12px 16px",
                margin: "0 0 16px 0",
                display: "flex",
                alignItems: "center",
                gap: "12px",
                fontSize: "0.875rem",
                color: "var(--text-primary, var(--color-text-primary))",
                animation: "fadeIn 0.3s ease-out",
            }}
        >
            <span style={{ fontSize: "1.2rem", flexShrink: 0 }} aria-hidden="true">🚧</span>
            <div style={{ flex: 1 }}>
                Memba&apos;s community {missing.length === 1 ? "realm" : "realms"} for {listFeatures(missing)}{" "}
                {missing.length === 1 ? "is" : "are"} not on <strong>{networkLabel}</strong> yet. You can read GovDAO and
                DAOs deployed by their members.
            </div>
        </div>
    )
}
