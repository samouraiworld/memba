import { createContext, useContext } from "react"
import type { SignRequest } from "./signer"

export interface TxNotice { id: number; kind: "ok" | "warn" | "fail"; title: string; sub: string }

export interface SignerApi {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- requests carry their own choice type
    sign: (req: SignRequest<any>) => void
    pending: readonly { id: number; label: string }[]
    notices: readonly TxNotice[]
    unread: number
    markRead: () => void
    /** Bumped after every settled signature, so windows re-read what changed. */
    version: number
}

export const SignerContext = createContext<SignerApi | null>(null)

export function useSigner(): SignerApi {
    const api = useContext(SignerContext)
    if (!api) throw new Error("useSigner outside SignerProvider")
    return api
}

