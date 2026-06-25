/**
 * ShowcaseBoard — visitor "board of doors" shell.
 *
 * Renders an ordered list of door slots:
 *   - Slot 0 = FeaturedDoor, full-width (spans all grid columns), EAGER-mounted.
 *   - Remaining slots (added in Task 1.2b) lazy-mount as they near the viewport.
 *
 * Resilience (reused from StateBoard, not reinvented):
 *   - PanelBoundary wraps each slot → a throwing door shows the neutral
 *     fallback + retry; siblings and the board container still render.
 *   - useInViewport (IntersectionObserver) lazy-mounts below-the-fold slots.
 *
 * Slot model: the board maps over a `slots` array that currently contains only
 * the featured slot. Task 1.2b appends more slot descriptors here — the shell,
 * boundary isolation, and lazy-mount come for free.
 *
 * @module components/home/ShowcaseBoard
 */

import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { PanelBoundary } from "./StateBoard"
import { useInViewport } from "../../hooks/home/useInViewport"
import { GovDaoSpotlight } from "./GovDaoSpotlight"
import { DAO_REALM_PATH } from "../../lib/config"
import { ContributorsDoor } from "./doors/ContributorsDoor"
import { NetworkHealthDoor } from "./doors/NetworkHealthDoor"
import { DirectoryDoor } from "./doors/DirectoryDoor"
import { LaunchpadDoor } from "./doors/LaunchpadDoor"
import "./home.css"

export interface ShowcaseBoardProps {
    /** Active network key; threaded down to each door for per-network data. */
    networkKey: string
}

interface ShowcaseSlot {
    /** Stable identity for React key + PanelBoundary keying + data-slot marker. */
    id: string
    /** Full-width slot spans all grid columns (grid-column: 1 / -1). */
    fullWidth?: boolean
    /** Mount immediately (above the fold). Omit for lazy-mount. */
    eager?: boolean
    /** Human label shown in the PanelBoundary fallback if the door throws. */
    label: string
    render: (networkKey: string) => ReactNode
}

// Ordered list of visitor showcase doors. Task 1.2b slots appended below.
// Each non-eager slot is automatically lazy-mounted + PanelBoundary-isolated.
const SLOTS: ShowcaseSlot[] = [
    {
        id: "govdao",
        fullWidth: true,
        eager: true,
        label: "governance",
        render: (networkKey) => <GovDaoSpotlight networkKey={networkKey} />,
    },
    {
        id: "contributors",
        label: "top contributors",
        render: (networkKey) => <ContributorsDoor networkKey={networkKey} />,
    },
    {
        id: "network-health",
        label: "network health",
        render: (networkKey) => <NetworkHealthDoor networkKey={networkKey} />,
    },
    {
        id: "directory",
        label: "directory",
        render: (networkKey) => <DirectoryDoor networkKey={networkKey} />,
    },
    {
        id: "launchpad",
        label: "launchpad",
        render: (networkKey) => <LaunchpadDoor networkKey={networkKey} />,
    },
]

/**
 * ShowcaseSlotHost — one slot: lazy-mount container + per-slot error boundary.
 * Reuses useInViewport + PanelBoundary from StateBoard so the resilience
 * behavior is identical to the shipped board.
 */
function ShowcaseSlotHost({
    slot,
    networkKey,
}: {
    slot: ShowcaseSlot
    networkKey: string
}) {
    const { ref, inView } = useInViewport()
    const shouldMount = slot.eager || inView

    const slotClass = slot.fullWidth
        ? "showcase-board__slot showcase-board__slot--full"
        : "showcase-board__slot"

    return (
        <div
            ref={slot.eager ? undefined : ref}
            className={slotClass}
            data-slot={slot.id}
            data-testid={`showcase-slot-${slot.id}`}
        >
            <PanelBoundary label={slot.label}>
                {shouldMount ? slot.render(networkKey) : null}
            </PanelBoundary>
        </div>
    )
}

export function ShowcaseBoard({ networkKey }: ShowcaseBoardProps) {
    return (
        <>
            <div className="showcase-board" data-testid="showcase-board">
                {SLOTS.map((slot) => (
                    <ShowcaseSlotHost key={slot.id} slot={slot} networkKey={networkKey} />
                ))}
            </div>
            {/* MembaDAO demoted from the featured hero to a bonus credit line. */}
            <div className="showcase-board__credit" data-testid="showcase-board-credit">
                Built on Memba ·{" "}
                <Link to={`/${networkKey}/dao/${DAO_REALM_PATH}`}>MembaDAO</Link>
            </div>
        </>
    )
}
