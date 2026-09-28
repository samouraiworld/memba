/** Chain-verified GovDAO proposal list for Directory.
 *
 * The general DAO reader permits a non-strict JSON probe and shares a cache
 * with best-effort callers. Directory must not label such data as belonging
 * to the selected chain, so it reads the canonical GovDAO Render pages with
 * strict, per-attempt RPC verification and lets React Query own the cache.
 */
import { detectMaxPage, hasOwnSubpageLink, queryRender, queryRenderPage, type DAOProposal } from "./dao/shared"
import { parseProposalList } from "./dao/proposals"

const MAX_PAGES = 10

async function readPages(rpcUrl: string, realmPath: string, base: string, first: string): Promise<DAOProposal[]> {
    const firstRows = parseProposalList(first, realmPath)
    const expectedHeader = base ? /^##\s+(?:Active|Inactive)\s+Proposals/m : /^##\s+Proposals\b/m
    if (firstRows.length === 0 && !expectedHeader.test(first)) {
        throw new Error("GovDAO proposal page could not be verified")
    }
    const maxPage = detectMaxPage(first)
    if (maxPage > MAX_PAGES) throw new Error("GovDAO proposal list exceeds the supported page limit")
    const pages = await Promise.all(Array.from({ length: Math.max(0, maxPage - 1) }, async (_, index) => {
        const page = await queryRenderPage(rpcUrl, realmPath, `${base}?page=${index + 2}`, true)
        if (!page) throw new Error("GovDAO proposal page could not be read")
        const rows = parseProposalList(page, realmPath)
        // A page advertised by the pager must contain proposal rows. Some
        // realms answer an unknown page with truthy "# Not Found" Markdown;
        // treating that as zero silently truncates an otherwise valid list.
        if (rows.length === 0) throw new Error("GovDAO proposal page could not be verified")
        return rows
    }))
    return [...firstRows, ...pages.flat()]
}

export async function fetchVerifiedDirectoryGovDAOProposals(rpcUrl: string, realmPath: string): Promise<DAOProposal[]> {
    const root = await queryRender(rpcUrl, realmPath, "", true)
    if (!root || root.trim() === "404") throw new Error("GovDAO could not be read on this network")

    let rows: DAOProposal[]
    if (hasOwnSubpageLink(root, realmPath, "proposals")) {
        const active = await queryRenderPage(rpcUrl, realmPath, "proposals", true)
        if (!active) throw new Error("GovDAO proposals page could not be read")
        const historyLinked = hasOwnSubpageLink(root, realmPath, "history")
        const history = historyLinked ? await queryRenderPage(rpcUrl, realmPath, "history", true) : null
        if (historyLinked && !history) throw new Error("GovDAO history page could not be read")
        const [activeRows, historyRows] = await Promise.all([
            readPages(rpcUrl, realmPath, "proposals", active),
            history ? readPages(rpcUrl, realmPath, "history", history) : Promise.resolve([]),
        ])
        rows = [...activeRows, ...historyRows]
    } else {
        rows = await readPages(rpcUrl, realmPath, "", root)
    }

    const seen = new Set<number>()
    return rows.filter(row => {
        if (seen.has(row.id)) return false
        seen.add(row.id)
        return true
    }).sort((a, b) => b.id - a.id)
}
