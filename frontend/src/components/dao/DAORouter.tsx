/**
 * DAORouter — Resolves DAO splat routes to the appropriate page component.
 *
 * Handles URLs like:
 *   /:network/dao/gno.land/r/gov/dao → DAOHome
 *   /:network/dao/gno.land/r/gov/dao/proposal/5 → ProposalView
 *   /:network/dao/gno.land/r/gov/dao/members → DAOMembers
 *   /:network/dao/gno.land~r~gov~dao → legacy redirect
 */
import { lazy, Suspense } from "react"
import { useParams, Navigate } from "react-router-dom"
import { parseDaoSplat } from "../../lib/daoSlug"
import { useNetworkKey } from "../../hooks/useNetworkNav"
import { ConnectingLoader } from "../ui/ConnectingLoader"
import { useDaoKind } from "../../hooks/useDaoKind"
import { DAOUnavailable } from "./DAOUnavailable"

const DAOHome = lazy(() => import("../../pages/DAOHome").then(m => ({ default: m.DAOHome })))
const ProposalView = lazy(() => import("../../pages/ProposalView").then(m => ({ default: m.ProposalView })))
const DAOMembers = lazy(() => import("../../pages/DAOMembers").then(m => ({ default: m.DAOMembers })))
const ProposeDAO = lazy(() => import("../../pages/ProposeDAO").then(m => ({ default: m.ProposeDAO })))
const ChannelsPage = lazy(() => import("../../pages/ChannelsPage").then(m => ({ default: m.ChannelsPage })))
const NotFound = lazy(() => import("../../pages/NotFound").then(m => ({ default: m.NotFound })))

function PageLoader() {
    return <ConnectingLoader message="Loading..." minHeight="30vh" />
}

export function DAORouter() {
    const { "*": splat = "" } = useParams()
    const networkKey = useNetworkKey()
    const { realmPath, subRoute } = parseDaoSplat(splat)
    const { capabilities, loading: kindLoading } = useDaoKind(realmPath || undefined)

    // Legacy ~ redirect: /test12/dao/gno.land~r~gov~dao → /test12/dao/gno.land/r/gov/dao
    if (splat.includes("~")) {
        const decoded = splat.replace(/~/g, "/")
        return <Navigate to={`/${networkKey}/dao/${decoded}`} replace />
    }

    // Invalid realm path
    if (!realmPath) {
        return <Suspense fallback={<PageLoader />}><NotFound /></Suspense>
    }

    // Parse sub-route
    const subParts = subRoute.split("/")
    const subCommand = subParts[0] || ""

    const daoHome = `/dao/${realmPath}`
    let element: React.ReactNode
    switch (subCommand) {
        case "":
            element = <DAOHome />
            break
        case "proposal":
            element = <ProposalView />
            break
        case "members":
            element = <DAOMembers />
            break
        case "propose":
            if (kindLoading) element = <PageLoader />
            else if (capabilities.propose.length === 0) element = <DAOUnavailable backTo={daoHome} reason="This DAO's contract does not accept proposals from Memba." />
            else element = <ProposeDAO />
            break
        case "treasury":
            // No DAO kind Memba supports can hold or spend funds.
            element = <DAOUnavailable backTo={daoHome} reason="Memba does not offer a treasury for DAOs." />
            break
        case "channels":
            if (kindLoading) element = <PageLoader />
            else if (!capabilities.channels) element = <DAOUnavailable backTo={daoHome} reason="Channels are not available for this DAO on this network." />
            else element = <ChannelsPage />
            break
        case "plugin":
            element = <DAOUnavailable backTo={daoHome} reason="DAO extensions are not available." />
            break
        default:
            element = <NotFound />
    }

    return <Suspense fallback={<PageLoader />}>{element}</Suspense>
}
