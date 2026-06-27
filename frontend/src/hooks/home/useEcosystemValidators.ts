/**
 * useEcosystemValidators — the real validator list for the home Ecosystem band.
 *
 * Neither the home snapshot (validatorsHealth is a summary only) nor
 * useValidatorHealth (it discards the list after computing the summary) carry
 * the actual validator rows, so the band's inline listing needs its own source.
 *
 * CHEAP SUBSET: calls getValidators() — the same single auto-paginated consensus
 * query useValidatorHealth uses — PLUS two cheap, cached name sources so the band
 * shows "gno-core-val-01" instead of "g1abc…xyz": fetchValoperMonikers() (ONE
 * on-chain Render parse, PRIMARY) and fetchMonitoringParticipation() (ONE cached
 * gnomonitoring call, SECONDARY — it names the genesis validators that aren't
 * registered in r/gnops/valopers, MH-16). It deliberately avoids the heavy
 * ~100-call /validators-page enrichment (fetchLastBlockSignatures / getAggregatedNetPeers).
 * getValidators() already returns the list sorted by voting power (desc), so
 * callers can slice top-N.
 *
 * HONESTY: never fabricates rows — getValidators() resolves to [] on error (its
 * own try/catch), so this hook returns an empty list and total 0, and the band
 * omits the validators section. A moniker that can't be resolved stays "" and
 * the band falls back to the truncated address.
 *
 * @module hooks/home/useEcosystemValidators
 */

import { useQuery } from "@tanstack/react-query"
import { useNetwork } from "../useNetwork"
import { getValidators, fetchValoperMonikers, type ValidatorInfo } from "../../lib/validators"
import { fetchMonitoringParticipation } from "../../lib/gnomonitoring"

const STALE_TIME = 60_000 // 1 minute (matches useValidatorHealth)

export interface EcosystemValidators {
    /** Validators sorted by voting power (desc) — full set; caller caps top-N. */
    validators: ValidatorInfo[]
    /** Total validator count (so a top-N slice can show "view all N"). */
    total: number
    loading: boolean
}

/**
 * Merge resolved valoper monikers (gnoAddr → moniker) into the validator rows.
 * Pure + order-preserving. A validator already carrying a moniker keeps it; an
 * unresolved address keeps its empty moniker (the band shows a truncated addr).
 */
export function applyMonikers(
    validators: ValidatorInfo[],
    monikers: Map<string, string>,
): ValidatorInfo[] {
    return validators.map((v) => {
        if (v.moniker?.trim()) return v
        const name = monikers.get(v.gnoAddr)?.trim()
        return name ? { ...v, moniker: name } : v
    })
}

/**
 * useEcosystemValidators — React Query hook for the band's validator listing.
 *
 * Never rejects: getValidators() degrades to [] on error; the moniker fetch is
 * best-effort (a failure leaves names blank, never throws), so callers get the
 * (possibly unnamed) list rather than an exception.
 */
export function useEcosystemValidators(): EcosystemValidators {
    const { rpcUrl } = useNetwork()

    const query = useQuery({
        queryKey: ["home", "ecosystem-validators", rpcUrl],
        queryFn: async () => {
            // Two cheap, cached name sources. valopers (on-chain) is PRIMARY;
            // gnomonitoring participation is SECONDARY — it names the genesis
            // validators (top-by-power) that aren't registered in r/gnops/valopers
            // (MH-16), so the band shows "gno-core-val-01" instead of "g1zhmw…".
            const [validators, valoperMonikers, participation] = await Promise.all([
                getValidators(rpcUrl),
                fetchValoperMonikers(rpcUrl).catch(() => new Map<string, string>()),
                fetchMonitoringParticipation().catch(() => null),
            ])
            let named = applyMonikers(validators, valoperMonikers)
            if (participation && participation.length > 0) {
                const monitoringMonikers = new Map<string, string>()
                for (const p of participation) {
                    if (p.moniker?.trim()) monitoringMonikers.set(p.addr.toLowerCase(), p.moniker)
                }
                // applyMonikers keeps any existing (valopers) name, so this only
                // fills the still-unnamed rows.
                named = applyMonikers(named, monitoringMonikers)
            }
            return named
        },
        staleTime: STALE_TIME,
    })

    const validators = query.data ?? []

    return {
        validators,
        total: validators.length,
        loading: query.isLoading,
    }
}
