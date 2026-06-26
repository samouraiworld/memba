import { useState } from "react"
import { Link } from "react-router-dom"
import { Plus, Briefcase, ChartBar, Bank, GameController, type Icon } from "@phosphor-icons/react"
import { useNetworkKey } from "../../hooks/useNetworkNav"
import { useIsMobile } from "../../hooks/useIsMobile"
import { useHomeActions } from "../../hooks/home/useHomeActions"
import type { LayoutContext } from "../../types/layout"
import { BottomSheet } from "./BottomSheet"

interface ActFabProps {
    connected: boolean
    auth: LayoutContext["auth"]
}

interface ActAction {
    id: string
    /** Matching `HomeAction.kind` for the live pending-count badge. */
    kind: "vote" | "sign" | "candidature" | "claim"
    to: string
    label: string
    Icon: Icon
}

// The four authed quick-actions (icons mirror the nav manifest for continuity).
const ACTIONS: ActAction[] = [
    { id: "sign", kind: "sign", to: "/multisig", label: "Sign", Icon: Briefcase },
    { id: "vote", kind: "vote", to: "/dashboard", label: "Vote", Icon: ChartBar },
    { id: "candidature", kind: "candidature", to: "/candidature", label: "Candidature", Icon: Bank },
    { id: "claim", kind: "claim", to: "/quests", label: "Claim", Icon: GameController },
]

/**
 * ActFab — the mobile "Act" floating action button. A bottom-right ⊕ that opens
 * a sheet of the member's high-value authed actions (sign / vote / candidature /
 * claim), each badged with its live pending count.
 *
 * Guarded so the data-bearing inner component only mounts on mobile AND when
 * connected: every action requires a wallet (no point for visitors) and the FAB
 * is mobile-only chrome (it lives in the always-mounted, CSS-hidden tab bar, so
 * without this guard a desktop member would needlessly run the home-actions
 * fetch). Hooks therefore live in {@link ActFabContent}, never called on desktop.
 */
export function ActFab({ connected, auth }: ActFabProps) {
    const isMobile = useIsMobile()
    if (!isMobile || !connected) return null
    return <ActFabContent auth={auth} />
}

function ActFabContent({ auth }: { auth: LayoutContext["auth"] }) {
    const nk = useNetworkKey()
    const [open, setOpen] = useState(false)
    const { actions } = useHomeActions(auth)

    const np = (path: string) => `/${nk}${path}`
    const countFor = (kind: ActAction["kind"]) => actions.filter(a => a.kind === kind).length
    const total = actions.length

    return (
        <>
            <button
                type="button"
                className="k-act-fab"
                aria-label={total > 0 ? `Quick actions, ${total} pending` : "Quick actions"}
                aria-expanded={open}
                onClick={() => setOpen(true)}
            >
                <Plus size={24} weight="bold" />
                {total > 0 && <span className="k-act-fab-badge">{total > 9 ? "9+" : total}</span>}
            </button>

            <BottomSheet open={open} onClose={() => setOpen(false)}>
                <div className="k-sidebar-section">
                    <div className="k-sidebar-section-label">Act</div>
                    {ACTIONS.map(({ id, kind, to, label, Icon }) => {
                        const count = countFor(kind)
                        return (
                            <Link
                                key={id}
                                to={np(to)}
                                className="k-sidebar-link"
                                onClick={() => setOpen(false)}
                            >
                                <span className="k-sidebar-icon"><Icon size={18} /></span>
                                <span className="k-sidebar-label">{label}</span>
                                {count > 0 && <span className="k-sidebar-badge">{count > 9 ? "9+" : count}</span>}
                            </Link>
                        )
                    })}
                </div>
            </BottomSheet>
        </>
    )
}
