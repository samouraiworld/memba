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
}

export function RealmsNotDeployedBanner({ deployed, networkLabel }: RealmsNotDeployedBannerProps) {
    if (deployed) return null

    return (
        <div
            role="status"
            style={{
                background: "linear-gradient(135deg, rgba(33,150,243,0.15), rgba(63,81,181,0.12))",
                border: "1px solid rgba(33,150,243,0.35)",
                borderRadius: "var(--radius-md, 10px)",
                padding: "12px 16px",
                margin: "0 0 16px 0",
                display: "flex",
                alignItems: "center",
                gap: "12px",
                fontSize: "0.875rem",
                color: "var(--text-primary, #fff)",
                animation: "fadeIn 0.3s ease-out",
            }}
        >
            <span style={{ fontSize: "1.2rem", flexShrink: 0 }} aria-hidden="true">🚧</span>
            <div style={{ flex: 1 }}>
                Memba isn't on <strong>{networkLabel}</strong> yet — its contracts are not
                deployed on this network, so DAO and channel features are unavailable here.
                Switch to a deployed network (e.g. <strong>Testnet 12</strong>) to use Memba.
            </div>
        </div>
    )
}
