/**
 * A weighted DAO (the governing Memba DAO) in its DAO folder window: the
 * weighted workspace, inside the window, on the OS session's wallet. It reads
 * the DAO through its own versioned contract (lib/dao/weighted), never through
 * the equal-headcount loaders the other DAO kinds use.
 *
 * @module os/daos/WeightedDaoFolder
 */
import { lazy } from "react"
import type { OsSession } from "../shell/useOsSession"

const ClassicPage = lazy(() => import("../page/ClassicPage").then((m) => ({ default: m.ClassicPage })))

export function WeightedDaoFolder({ realmPath, session, active }: { realmPath: string; session: OsSession; active?: boolean }) {
    return <ClassicPage network={session.network.key} page={`weighted-dao/${realmPath}`} layout={session.layout} active={active} />
}
