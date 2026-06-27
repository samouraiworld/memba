/**
 * MemberHero — the connected member's above-the-fold anchor (W-M1).
 *
 * Mirrors the visitor hero's editorial 2-column grid so the logged-in page reads
 * at the same bar:
 *   - left  = identity: initials avatar + @username/address + honest wallet balance
 *   - right = standing "proof object": XP / rank / progress toward Memba DAO
 *             candidature (350 XP = Gold), parallel to the visitor's NetworkProofCard.
 *
 * Honesty contract: the wallet address is always present, so the hero never
 * blanks; the balance chip is omitted unless the on-chain balance is positive
 * (rawUgnot > 0n, see WalletChips); 0 XP is an honest "Newcomer" starting rung
 * framed as a journey (rank + next-step CTA), never a fabricated metric.
 *
 * @module components/home/MemberHero
 */
import { Link, useOutletContext } from "react-router-dom"
import type { LayoutContext } from "../../types/layout"
import { useNetworkKey } from "../../hooks/useNetworkNav"
import { useMemberIdentity } from "../../hooks/home/useMemberIdentity"
import { useMemberStanding, type MemberStanding } from "../../hooks/home/useMemberStanding"
import "./home.css"

/** Truncate a Gno address to "g1ab…cdef" form (4 + … + 4 chars). */
function truncateAddress(addr: string): string {
    if (addr.length <= 10) return addr
    return `${addr.slice(0, 4)}…${addr.slice(-4)}`
}

/** Wallet chips row — balance + address, both optional (honest: omit when absent).
 *
 * The balance display is gated on the numeric `rawUgnot`, NOT the `balance`
 * string: useBalance only ever emits a "… GNOT" string ("— GNOT" loading,
 * "? GNOT" error, "0 GNOT" empty), so a string check can never honour the
 * honesty contract. Show the chip only for a strictly positive on-chain balance. */
export function WalletChips({ balance, rawUgnot, address }: { balance: string; rawUgnot: bigint; address: string }) {
    const showBalance = rawUgnot > 0n
    const showAddress = !!address

    if (!showBalance && !showAddress) return null

    return (
        <div className="wallet-chips" data-testid="wallet-chips">
            {showBalance && (
                <span className="wallet-chip wallet-chip--balance" data-testid="wallet-chip-balance">
                    {balance}
                </span>
            )}
            {showAddress && (
                <span className="wallet-chip wallet-chip--address" data-testid="wallet-chip-address">
                    {truncateAddress(address)}
                </span>
            )}
        </div>
    )
}

/** Right-side standing card — the member's XP / rank / candidature progress. */
function MemberStandingCard({ standing, networkKey }: { standing: MemberStanding; networkKey: string }) {
    const { totalXP, rank, xpToCandidature, candidatureProgress, isEligible } = standing
    const pct = Math.round(candidatureProgress * 100)

    return (
        <aside className="member-standing" data-testid="member-standing" aria-label="Membership progress">
            <span className="member-standing__label">
                <span
                    className="member-standing__rank-dot"
                    style={{ background: rank.color }}
                    aria-hidden="true"
                />
                {rank.name.toLowerCase()}
            </span>

            <span className="member-standing__xp">
                <span className="member-standing__xp-value" data-testid="member-standing-xp">
                    {totalXP.toLocaleString()}
                </span>
                <span className="member-standing__xp-unit"> XP</span>
            </span>

            <div
                className="member-standing__bar"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Progress to Memba DAO candidature"
            >
                <div className="member-standing__bar-fill" style={{ width: `${pct}%` }} />
            </div>

            {isEligible ? (
                <Link
                    to={`/${networkKey}/candidature`}
                    className="member-standing__cta member-standing__cta--eligible"
                    data-testid="member-standing-apply"
                >
                    Apply to Memba DAO →
                </Link>
            ) : (
                <>
                    <span className="member-standing__hint">
                        {xpToCandidature.toLocaleString()} XP to Memba DAO candidature
                    </span>
                    <Link
                        to={`/${networkKey}/quests`}
                        className="member-standing__cta"
                        data-testid="member-standing-quests"
                    >
                        Earn XP →
                    </Link>
                </>
            )}
        </aside>
    )
}

export function MemberHero() {
    const { adena, balance, rawUgnot, auth } = useOutletContext<LayoutContext>()
    const networkKey = useNetworkKey()

    const address = adena.connected ? adena.address : (auth.address || "")
    const identity = useMemberIdentity(address || null)
    const standing = useMemberStanding(address || null, auth.isAuthenticated)

    return (
        <section className="member-hero" data-testid="member-hero" aria-label="Your standing">
            <div className="member-hero__lead">
                <span className="member-hero__eyebrow">welcome back</span>
                <div className="member-hero__identity">
                    <span className="member-hero__avatar" aria-hidden="true">{identity.initials}</span>
                    <span className="member-hero__name" data-testid="member-hero-name">{identity.displayName}</span>
                </div>
                <WalletChips balance={balance} rawUgnot={rawUgnot ?? 0n} address={address} />
            </div>

            <MemberStandingCard standing={standing} networkKey={networkKey} />
        </section>
    )
}
