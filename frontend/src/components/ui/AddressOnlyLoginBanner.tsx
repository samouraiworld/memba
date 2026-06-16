/**
 * AddressOnlyLoginBanner — shown when the user is signed in via the ADDRESS-ONLY
 * path: their wallet has no on-chain public key, so Adena (#800) can't produce a
 * signature and Memba authenticated them by address alone (no ownership proof).
 *
 * It's a non-blocking nudge to upgrade to secure signed login. The upgrade can't
 * be one-click — Adena won't let a dApp trigger an untransacted wallet's first
 * tx — so we guide: fund via the faucet, then make any one transaction in Adena
 * (the wallet's first tx registers its pubkey). After that, login is signed and
 * this banner disappears (the wallet now exposes a pubkey).
 *
 * `show` comes from the auth bridge (connected + authenticated + no pubkeyJSON).
 */

interface AddressOnlyLoginBannerProps {
    /** True when the active session was authenticated by address only. */
    show: boolean
    /** Faucet URL for the active network (empty = no faucet → link omitted). */
    faucetUrl: string
}

export function AddressOnlyLoginBanner({ show, faucetUrl }: AddressOnlyLoginBannerProps) {
    if (!show) return null

    return (
        <div
            role="status"
            style={{
                background: "linear-gradient(135deg, rgba(255,193,7,0.14), rgba(255,152,0,0.10))",
                border: "1px solid rgba(255,193,7,0.35)",
                borderRadius: "var(--radius-md, 10px)",
                padding: "12px 16px",
                margin: "0 0 16px 0",
                display: "flex",
                alignItems: "center",
                gap: "12px",
                fontSize: "0.875rem",
                color: "var(--text-primary, #fff)",
                animation: "fadeIn 0.3s ease-out",
            }}
        >
            <span style={{ fontSize: "1.2rem", flexShrink: 0 }} aria-hidden="true">🔓</span>
            <div style={{ flex: 1 }}>
                You're signed in with <strong>address-only</strong> verification (your wallet has no
                on-chain key yet). For <strong>secure signed login</strong>, activate your wallet:
                {faucetUrl ? (
                    <> <a href={faucetUrl} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>get test GNOT from the faucet</a>, then make any one transaction in Adena.</>
                ) : (
                    <> make any one transaction in Adena (its first tx registers your key).</>
                )}
            </div>
        </div>
    )
}
