/**
 * useEcosystemValidators — the real validator list for the home Ecosystem band.
 *
 * Neither the home snapshot (validatorsHealth is a summary only) nor
 * useValidatorHealth (it discards the list after computing the summary) carry
 * the actual validator rows, so the band's inline listing needs its own source.
 *
 * CHEAP SUBSET ONLY: calls getValidators() — the same single auto-paginated
 * consensus query useValidatorHealth uses — and nothing heavier (no
 * fetchLastBlockSignatures / fetchValoperMonikers / getAggregatedNetPeers,
 * which are the ~100-call /validators-page enrichment). getValidators() already
 * returns the list sorted by voting power (desc), so callers can slice top-N.
 *
 * HONESTY: never fabricates rows — getValidators() resolves to [] on error
 * (its own try/catch), so this hook returns an empty list and total 0, and the
 * band omits the validators section.
 *
 * @module hooks/home/useEcosystemValidators
 */

import { useQuery } from "@tanstack/react-query"
import { useNetwork } from "../useNetwork"
import { getValidators, type ValidatorInfo } from "../../lib/validators"

const STALE_TIME = 60_000 // 1 minute (matches useValidatorHealth)

export interface EcosystemValidators {
    /** Validators sorted by voting power (desc) — full set; caller caps top-N. */
    validators: ValidatorInfo[]
    /** Total validator count (so a top-N slice can show "view all N"). */
    total: number
    loading: boolean
}

/**
 * useEcosystemValidators — React Query hook for the band's validator listing.
 *
 * Never rejects: getValidators() degrades to [] on error, so callers get an
 * empty list / total 0 (and the section is omitted) rather than an exception.
 */
export function useEcosystemValidators(): EcosystemValidators {
    const { rpcUrl } = useNetwork()

    const query = useQuery({
        queryKey: ["home", "ecosystem-validators", rpcUrl],
        queryFn: () => getValidators(rpcUrl),
        staleTime: STALE_TIME,
    })

    const validators = query.data ?? []

    return {
        validators,
        total: validators.length,
        loading: query.isLoading,
    }
}
