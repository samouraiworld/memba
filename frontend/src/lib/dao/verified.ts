/**
 * Verified DAO identities. A DAO is "verified" only by an exact chain id and
 * realm path match; a self-declared name never verifies anything. The demo
 * DAO realms are deliberately absent.
 */
import { MEMBA_DAO, NETWORKS } from "../config"

export interface VerifiedDao {
    path: string
    name: string
}

export const VERIFIED_DAOS: Readonly<Record<string, ReadonlyArray<VerifiedDao>>> = Object.freeze({
    [NETWORKS.mainnet.chainId]: [{ path: "gno.land/r/gov/dao", name: "GovDAO" }],
    [NETWORKS.pearl.chainId]: [
        { path: "gno.land/r/gov/dao", name: "GovDAO" },
        { path: MEMBA_DAO.realmPath, name: "Memba DAO" },
    ],
})

export interface DaoIdentity {
    verified: boolean
    /** The verified name when the path is verified on this chain. */
    verifiedName: string | null
    /** The verified name this DAO's self-declared name imitates, if any. */
    lookalikeOf: string | null
}

const normalize = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase()

export function daoIdentity(chainId: string, realmPath: string, selfDeclaredName: string): DaoIdentity {
    const list = VERIFIED_DAOS[chainId] ?? []
    const exact = list.find((d) => d.path === realmPath)
    if (exact) return { verified: true, verifiedName: exact.name, lookalikeOf: null }
    const name = normalize(selfDeclaredName || "")
    const imitated = name ? list.find((d) => normalize(d.name) === name) : undefined
    return { verified: false, verifiedName: null, lookalikeOf: imitated?.name ?? null }
}
