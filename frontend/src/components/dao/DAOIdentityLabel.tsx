/**
 * DAOIdentityLabel — "Verified" only for an exact chain + realm path match,
 * "Unverified" otherwise, plus a warning when the self-declared name copies a
 * verified DAO's name.
 */
import { GNO_CHAIN_ID } from "../../lib/config"
import { daoIdentity } from "../../lib/dao/verified"

export function DAOIdentityLabel({ realmPath, name, chainId = GNO_CHAIN_ID }: { realmPath: string; name: string; chainId?: string }) {
    const identity = daoIdentity(chainId, realmPath, name)
    return (
        <>
            <span
                className={`dao-identity-label dao-identity-label--${identity.verified ? "verified" : "unverified"}`}
                title={identity.verified ? "Realm path matches a verified DAO on this network" : "Not a verified DAO: check the realm path"}
                style={{ display: "inline-block", marginLeft: 6, padding: "1px 6px", borderRadius: 4, fontSize: "var(--pro-caption, 10px)", fontWeight: 600, border: "1px solid var(--color-k-edge)", color: identity.verified ? "var(--color-k-accent-text, var(--color-primary))" : "var(--color-k-dim, var(--color-text-secondary))" }}
            >
                {identity.verified ? "Verified" : "Unverified"}
            </span>
            {identity.lookalikeOf && (
                <span className="dao-identity-warning" role="alert" style={{ display: "block", marginTop: 4, fontSize: "var(--pro-small, 12px)", color: "var(--color-warning)" }}>
                    This DAO uses the name of a verified DAO at another address
                </span>
            )}
        </>
    )
}
