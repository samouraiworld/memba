/**
 * Signing on Memba DAO from a window: read the fee, open the sheet, re-read
 * Memba DAO after each signature settles, and show the lock an attempt with an
 * unknown outcome keeps.
 *
 * @module os/daos/useGovSign
 */
import { useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { readGovernanceReceipt, type GovernanceScope } from "../../lib/dao/governanceRecovery"
import { useAlive } from "../shell/useAlive"
import type { OsSession } from "../shell/useOsSession"
import type { SignRequest } from "../sign/signer"
import { useSigner } from "../sign/signerContext"
import type { GovSigner } from "./govRequests"
import { quoteSheetGasPrice } from "./sheetFee"
import { UnknownOutcome } from "./UnknownOutcome"

/** Reads the fee, then opens the signing sheet; re-reads Memba DAO after each signature settles. */
export function useGovSign(session: OsSession) {
    const signer = useSigner()
    const alive = useAlive()
    const queryClient = useQueryClient()
    const [quoting, setQuoting] = useState(false)
    const [failure, setFailure] = useState<string | null>(null)
    const [, rerender] = useState(0)
    useEffect(() => {
        if (signer.version > 0) void queryClient.invalidateQueries({ queryKey: ["dao", "gov"] })
    }, [signer.version, queryClient])
    /** A request that cannot be built is reported, never left as an unhandled rejection. */
    const start = (build: (s: GovSigner) => SignRequest) => {
        setQuoting(true)
        setFailure(null)
        void quoteSheetGasPrice().then((gasPrice) => {
            if (!alive.current) return
            setQuoting(false)
            try {
                signer.sign(build({ caller: session.address, gasPrice }))
            } catch (e) {
                setFailure(e instanceof Error ? e.message : "This action cannot be built.")
            }
        })
    }
    /** The lock of an attempt whose outcome is unknown, if one is saved. */
    const lock = (scope: GovernanceScope, attempt: "vote" | "execution" | "join" | "pause" | "proposal") => {
        const receipt = readGovernanceReceipt(scope)
        return receipt && <UnknownOutcome key={JSON.stringify(scope)} scope={scope} receipt={receipt} attempt={attempt} onCleared={() => rerender((x) => x + 1)} />
    }
    const failed = failure && <p className="os-note os-err" role="alert">{failure} Nothing was sent.</p>
    return { quoting, start, lock, failed }
}
