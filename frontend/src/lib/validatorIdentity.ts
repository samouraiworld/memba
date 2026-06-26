/**
 * validatorIdentity — curated map from a validator (by moniker or on-chain address)
 * to its gnolove identity: a contributor (GitHub login) or a team (slug).
 *
 * Validators run by a known team/person don't expose that link on-chain (the valoper
 * record has no GitHub field, and the consensus address isn't a gnolove `wallet`), so we
 * curate it here. The Contributions tab uses this to show the real gnolove contributions
 * of the team/person behind the validator, instead of an empty address-keyed lookup.
 *
 * Extend by adding entries below (keyed by lowercased moniker, or by operator/signing
 * address for precision — address wins over moniker).
 */

export type ValidatorGnoloveIdentity =
    | { kind: "team"; slug: string; label: string }
    | { kind: "contributor"; login: string; label: string }

const team = (slug: string, label: string): ValidatorGnoloveIdentity => ({ kind: "team", slug, label })
const contributor = (login: string, label = login): ValidatorGnoloveIdentity => ({ kind: "contributor", login, label })

/** Keyed by lowercased moniker. */
const BY_MONIKER: Record<string, ValidatorGnoloveIdentity> = {
    "gno-core-val-01": team("all-in-bits", "All in Bits"),
    "gno-core-val-02": team("all-in-bits", "All in Bits"),
    "samourai-crew-1": team("samouraiworld", "Samourai.world"),
    "aeddi-1": contributor("aeddi"),
    "gfanton-1": contributor("gfanton"),
}

/** Keyed by operator OR signing address (g1…). Takes precedence over moniker. */
const BY_ADDRESS: Record<string, ValidatorGnoloveIdentity> = {
    "g19rl4cm2hmr8afy4kldpxz3fka4jguq0a0u3773": contributor("gfanton"),
}

/** Resolve a validator's curated gnolove identity, or null when unmapped.
 *  Address match wins over moniker (more precise / stable across moniker changes). */
export function resolveValidatorIdentity(opts: {
    moniker?: string | null
    addresses?: (string | null | undefined)[]
}): ValidatorGnoloveIdentity | null {
    for (const a of opts.addresses ?? []) {
        if (a && BY_ADDRESS[a]) return BY_ADDRESS[a]
    }
    const m = (opts.moniker ?? "").trim().toLowerCase()
    if (m && BY_MONIKER[m]) return BY_MONIKER[m]
    return null
}
