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

const DAOHome = lazy(() => import("../../pages/DAOHome").then(m => ({ default: m.DAOHome })))
const ProposalView = lazy(() => import("../../pages/ProposalView").then(m => ({ default: m.ProposalView })))
const DAOMembers = lazy(() => import("../../pages/DAOMembers").then(m => ({ default: m.DAOMembers })))
const ProposeDAO = lazy(() => import("../../pages/ProposeDAO").then(m => ({ default: m.ProposeDAO })))
const Treasury = lazy(() => import("../../pages/Treasury").then(m => ({ default: m.Treasury })))
const TreasuryProposal = lazy(() => import("../../pages/TreasuryProposal").then(m => ({ default: m.TreasuryProposal })))
const ChannelsPage = lazy(() => import("../../pages/ChannelsPage").then(m => ({ default: m.ChannelsPage })))
const PluginPage = lazy(() => import("../../pages/PluginPage").then(m => ({ default: m.PluginPage })))
const NotFound = lazy(() => import("../../pages/NotFound").then(m => ({ default: m.NotFound })))

function PageLoader() {
    return <ConnectingLoader message="Loading..." minHeight="30vh" />
}

export function DAORouter() {
    const { "*": splat = "" } = useParams()
    const networkKey = useNetworkKey()
    const { realmPath, subRoute } = parseDaoSplat(splat)

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
            element = <ProposeDAO />
            break
        case "treasury":
            if (subParts[1] === "propose") {
                element = <TreasuryProposal />
            } else {
                element = <Treasury />
            }
            break
        case "channels":
            element = <ChannelsPage />
            break
        case "plugin":
            element = <PluginPage />
            break
        default:
            element = <NotFound />
    }

    return <Suspense fallback={<PageLoader />}>{element}</Suspense>
}
