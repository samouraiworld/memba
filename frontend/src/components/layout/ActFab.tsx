import { useState } from "react"
import { Link } from "react-router-dom"
import { Plus, Briefcase, ChartBar, Bank, GameController, type Icon } from "@phosphor-icons/react"
import { useNetworkKey } from "../../hooks/useNetworkNav"
import { BottomSheet } from "./BottomSheet"

interface ActFabProps {
    connected: boolean
}

interface ActAction {
    id: string
    to: string
    label: string
    Icon: Icon
}

// The four authed quick-actions (icons mirror the nav manifest for continuity).
const ACTIONS: ActAction[] = [
    { id: "sign", to: "/multisig", label: "Sign", Icon: Briefcase },
    { id: "vote", to: "/dashboard", label: "Vote", Icon: ChartBar },
    { id: "candidature", to: "/candidature", label: "Candidature", Icon: Bank },
    { id: "claim", to: "/quests", label: "Claim", Icon: GameController },
]

/**
 * ActFab — the mobile "Act" floating action button. A bottom-right ⊕ that opens
 * a sheet of the member's high-value authed actions (sign / vote / candidature /
 * claim). Every action requires a connected wallet, so the FAB renders nothing
 * for visitors. Mobile-only: it lives inside the tab bar's `.k-mobile-only`
 * container and never appears on desktop.
 */
export function ActFab({ connected }: ActFabProps) {
    const nk = useNetworkKey()
    const [open, setOpen] = useState(false)

    if (!connected) return null

    const np = (path: string) => `/${nk}${path}`

    return (
        <>
            <button
                type="button"
                className="k-act-fab"
                aria-label="Quick actions"
                aria-expanded={open}
                onClick={() => setOpen(true)}
            >
                <Plus size={24} weight="bold" />
            </button>

            <BottomSheet open={open} onClose={() => setOpen(false)}>
                <div className="k-sidebar-section">
                    <div className="k-sidebar-section-label">Act</div>
                    {ACTIONS.map(({ id, to, label, Icon }) => (
                        <Link
                            key={id}
                            to={np(to)}
                            className="k-sidebar-link"
                            onClick={() => setOpen(false)}
                        >
                            <span className="k-sidebar-icon"><Icon size={18} /></span>
                            <span className="k-sidebar-label">{label}</span>
                        </Link>
                    ))}
                </div>
            </BottomSheet>
        </>
    )
}
