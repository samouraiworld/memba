/**
 * DepositOverride — explicit approval of a storage-deposit cap above the
 * 10 GNOT ceiling. Shown only when a plan needs it; unchecked by default. The
 * approval is bound by the caller to the exact plan it was given for.
 */
import { formatUgnotExact, V2_MAX_DEPOSIT_UGNOT } from "../../lib/dao/v2Budget"

export function DepositOverride({ maxDepositUgnot, approved, onApprovedChange }: {
    maxDepositUgnot: number
    approved: boolean
    onApprovedChange: (approved: boolean) => void
}) {
    const amount = formatUgnotExact(maxDepositUgnot)
    return (
        <div className="dao-shell-banner" role="alert" aria-label="Storage deposit above the limit">
            <p>
                This transaction lets the DAO realm lock up to <strong>{amount}</strong> from your account as a storage deposit,
                above the usual {formatUgnotExact(V2_MAX_DEPOSIT_UGNOT)} limit. Allow it only if you expected a deposit this large.
            </p>
            <label>
                <input type="checkbox" checked={approved} onChange={(e) => onApprovedChange(e.target.checked)} /> Allow a storage deposit of up to {amount}
            </label>
        </div>
    )
}
