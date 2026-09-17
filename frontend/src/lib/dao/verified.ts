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
        // The realm's own on-chain name.
        { path: MEMBA_DAO.realmPath, name: "MembaDAO" },
    ],
})

export interface DaoIdentity {
    verified: boolean
    /** The verified name when the path is verified on this chain. */
    verifiedName: string | null
    /** The verified DAO name this DAO's self-declared name matches, if any. */
    lookalikeOf: string | null
}

/** Compare names without case, whitespace, punctuation or symbols ("Gov DAO" = "govdao"). */
const normalize = (name: string) => name.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "")

export function daoIdentity(chainId: string, realmPath: string, selfDeclaredName: string): DaoIdentity {
    const list = VERIFIED_DAOS[chainId] ?? []
    const exact = list.find((d) => d.path === realmPath)
    if (exact) return { verified: true, verifiedName: exact.name, lookalikeOf: null }
    const name = normalize(selfDeclaredName || "")
    const sameName = name ? list.find((d) => normalize(d.name) === name) : undefined
    return { verified: false, verifiedName: null, lookalikeOf: sameName?.name ?? null }
}
