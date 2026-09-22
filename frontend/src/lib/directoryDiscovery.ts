import { NETWORKS } from "./config"
import { directorySeeds } from "./directorySeeds"
import { fetchNamespaceListing } from "./gnoweb"
import type { DirectoryDAO, DirectoryPackage, DirectoryRealm, DiscoveryProvenance } from "./directory"

export interface DirectoryDiscovery {
    packages: DirectoryPackage[]
    realms: DirectoryRealm[]
    status: "ready" | "partial" | "unavailable"
    checkedAt?: string
}
export function directorySeedData(networkKey: string, daos: DirectoryDAO[]): DirectoryDiscovery {
    const { packages, realms } = directorySeeds(networkKey)
    if (!NETWORKS[networkKey]) return { packages, realms, status: "unavailable" }
    const paths = new Set(realms.map(item => item.path))
    for (const dao of daos) {
        if (dao.isSaved && !paths.has(dao.path)) {
            realms.push({ name: dao.name, path: dao.path, description: "Saved DAO · deployment not checked", category: "standard", networkKey, provenance: "saved" })
            paths.add(dao.path)
        }
    }
    return { packages, realms, status: "partial" }
}
/** Two bounded namespace reads. The old Gnolove feed has no chain identity;
 * omit it instead of presenting historical heights as selected-network facts.
 * This directory is deliberately not a complete chain index.
 */
export async function fetchDirectoryDiscovery(networkKey: string, daos: DirectoryDAO[]): Promise<DirectoryDiscovery> {
    const result = directorySeedData(networkKey, daos)
    const network = NETWORKS[networkKey]
    if (!network?.explorerUrl) return { ...result, status: "unavailable" }
    const [packages, realms] = await Promise.all([
        fetchNamespaceListing(network.explorerUrl, "samcrew", "p", network.chainId),
        fetchNamespaceListing(network.explorerUrl, "samcrew", "r", network.chainId),
    ])
    const checkedAt = new Date().toISOString()
    for (const [kind, listing] of [["p", packages], ["r", realms]] as const) {
        if (listing.status !== "ready") continue
        for (const item of listing.items) {
            const path = `gno.land${item.path}`
            const rows = kind === "p" ? result.packages : result.realms
            const existing = rows.find(row => row.path === path)
            const metadata = { networkKey, provenance: "namespace" as const, checkedAt, gnowebUrl: item.gnowebUrl }
            if (existing) Object.assign(existing, metadata)
            else if (kind === "p") result.packages.push({ name: item.name, path, description: "Listed in this network’s samcrew namespace", ...metadata })
            else result.realms.push({ name: item.name, path, description: "Listed in this network’s samcrew namespace", category: "unknown", ...metadata })
        }
    }
    return { ...result, checkedAt, status: packages.status === "ready" && realms.status === "ready" ? "ready" : "partial" }
}
export function discoveryProvenanceLabel(item: DiscoveryProvenance): string {
    if (item.provenance === "namespace") return "Namespace listing · read status not checked"
    if (item.provenance === "editorial") return `Editorial · source checked ${item.checkedAt}`
    if (item.provenance === "saved") return "Saved path · deployment not checked"
    return "Reference · deployment not checked"
}
