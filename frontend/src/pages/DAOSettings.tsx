/**
 * DAOSettings — the rules of a version-2 DAO, read-only.
 *
 * A version-2 realm's settings are fixed at deployment; only membership, roles
 * and the archived flag change, and only through executed proposals.
 */
import { useQuery } from "@tanstack/react-query"
import { GNO_RPC_URL, getExplorerBaseUrl } from "../lib/config"
import { getDAOConfig } from "../lib/dao"
import { formatDuration } from "../lib/templates/dao/v2/duration"
import { useDaoRoute } from "../hooks/useDaoRoute"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"
import { DAOIdentityLabel } from "../components/dao/DAOIdentityLabel"
import "../components/dao/dao-shell.css"

const ROLES_GRANT_NOTHING = "Roles are labels; they grant no special powers."

export function DAOSettings() {
    const { realmPath } = useDaoRoute()
    const configQuery = useQuery({
        queryKey: ["dao", "config", realmPath ?? ""],
        enabled: !!realmPath,
        queryFn: () => getDAOConfig(GNO_RPC_URL, realmPath, true),
    })

    if (configQuery.isPending) {
        return <div className="animate-fade-in dao-settings"><SkeletonCard /><SkeletonCard /></div>
    }

    const v2 = configQuery.data?.v2
    if (configQuery.isError || !v2) {
        return (
            <div className="animate-fade-in dao-settings" role="status">
                <h2 className="dao-settings__title">Settings</h2>
                <p className="dao-settings__note">The DAO's settings could not be read.</p>
                <button className="k-btn-secondary" onClick={() => { void configQuery.refetch() }}>Retry</button>
            </div>
        )
    }

    const sourceUrl = `${getExplorerBaseUrl()}/r/${realmPath.replace("gno.land/r/", "")}$source`
    const rows: [string, string][] = [
        ["Name", v2.name],
        ["Description", v2.description || "None"],
        ["Realm path", realmPath],
        ["Status", v2.archived ? "Archived" : "Active"],
        ["Contract template", v2.template_version],
        ["Contract API", v2.api_version],
        ["Approval threshold", `${v2.threshold}% of all voting power`],
        ["Quorum", v2.quorum === 0 ? "None" : `${v2.quorum}% of all voting power must vote`],
        ["Voting period", formatDuration(v2.voting_period)],
        ["Execution delay", formatDuration(v2.execution_delay)],
        ["Execution window", formatDuration(v2.execution_window)],
        ["Proposal categories", v2.categories.join(", ")],
        ["Roles", v2.roles.length > 0 ? v2.roles.join(", ") : "None"],
        ["Members", String(v2.member_count)],
        ["Total voting power", v2.total_power.toLocaleString("en-US")],
        ["Membership version", String(v2.electorate_version)],
        ["Proposals", String(v2.proposal_count)],
    ]

    return (
        <section className="animate-fade-in dao-settings" aria-labelledby="dao-settings-title">
            <div>
                <h2 id="dao-settings-title" className="dao-settings__title">Settings</h2>
                <p className="dao-settings__note">
                    {v2.name}
                    <DAOIdentityLabel realmPath={realmPath} name={v2.name} />
                </p>
            </div>
            {v2.archived && (
                <p className="dao-shell-banner" role="status">This DAO is archived. It no longer accepts proposals, votes or executions.</p>
            )}
            <dl className="k-card dao-settings__list">
                {rows.map(([label, value]) => (
                    <div key={label} style={{ display: "contents" }}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                    </div>
                ))}
            </dl>
            <p className="dao-settings__note">{ROLES_GRANT_NOTHING} Members, roles and archiving change only through proposals that pass a vote.</p>
            <p className="dao-settings__note">Rules are permanent; to change them, create a new DAO and move members by proposal.</p>
            <p className="dao-settings__note">The template version is reported by the contract itself. Check the realm path and the source before relying on it.</p>
            <a className="k-btn-secondary" href={sourceUrl} target="_blank" rel="noopener noreferrer" style={{ alignSelf: "flex-start" }}>
                View source
            </a>
        </section>
    )
}
