/**
 * What the lane's signing controls share: one click that reads what the sheet
 * needs and opens it (or keeps why it cannot), the quote a new order is made
 * at, why a collection's tokens cannot be traded in this market, and a token
 * as the ledger has it now. A guest is asked to connect only when it acts.
 *
 * @module os/apps/market/nft/signing
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { networkGasPriceFresh, type GasPrice } from "../../../../lib/grc20"
import { getToken, type NftCollection } from "../../../../lib/nft/ledger"
import { getMarketTerms, type NftSplit } from "../../../../lib/nft/market"
import { ReadError, RealmRefusedError } from "../../../../lib/nft/read"
import { NFT_MARKET_ADDRESS } from "../../../../lib/nft/trade"
import { TokenLaunchpadReadError } from "../../../../lib/tokenLaunchpadClient"
import { laneClosedReason, readActionStatus } from "../../../../lib/tokenLaunchpadConfigClient"
import type { SignRequest } from "../../../sign/signer"
import { useSigner } from "../../../sign/signerContext"
import type { OsSession } from "../../../shell/useOsSession"

/** A failed check before the review, in words a member can act on. */
function reason(err: unknown): string {
    if (err instanceof ReadError) return "The network could not be read. Try again in a moment."
    if (err instanceof RealmRefusedError) return "The network refused this read. Refresh the page."
    if (err instanceof TokenLaunchpadReadError) {
        if (err.code === "realm_error") return "The market's configuration refused this read. Refresh the page."
        if (err.code === "invalid_response") return "The market's configuration answered in a form this version does not read."
        return "The network could not be read. Try again in a moment."
    }
    return err instanceof Error ? err.message : String(err)
}

/**
 * One signing control's state. `run` asks a guest to connect; for a member it
 * builds the request (reading what it needs) and opens the sheet, or keeps
 * the reason it could not. A request that resolves after the control is gone
 * opens nothing. Orders and holdings are read again once the chain has the result.
 */
export function useSignAction(session: OsSession) {
    const signer = useSigner()
    const client = useQueryClient()
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")
    const alive = useRef(true)
    useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
    const afterTrade = (outcome: string) => {
        if (outcome !== "confirmed" && outcome !== "submitted") return
        void client.invalidateQueries({ queryKey: ["nft", "market"] })
        void client.invalidateQueries({ queryKey: ["nft", "ledger"] })
    }
    /** For a guest: asks it to connect and answers true, before anything it typed is checked. */
    const connectFirst = () => {
        if (session.status === "member") return false
        session.openConnect()
        return true
    }
    const run = async (open: (caller: string) => Promise<SignRequest>) => {
        if (connectFirst()) return
        setError("")
        setBusy(true)
        try {
            const request = await open(session.address)
            if (alive.current) signer.sign(request)
        } catch (err) {
            if (alive.current) setError(reason(err))
        } finally {
            if (alive.current) setBusy(false)
        }
    }
    return { busy, error, setError, connectFirst, run, afterTrade }
}

export interface Quote {
    gas: GasPrice
    feeBPS: bigint
    split: NftSplit
}

/** What a new order at `price` costs now on `networkKey`: the network's gas price, the market lane open, and the fee and split the market quotes. */
export async function quoteOrder(networkKey: string, collection: string, price: bigint, what: string): Promise<Quote> {
    const [gas, status, terms] = await Promise.all([networkGasPriceFresh(), readActionStatus(networkKey, "nft_market", "ugnot"), getMarketTerms(collection, price)])
    if (!status.open) throw new Error(laneClosedReason(status, "Trading"))
    if (terms.feeBPS === null || terms.split === null) throw new Error(`The market takes no new ${what} on this network: its protocol fee is not set.`)
    return { gas, feeBPS: terms.feeBPS, split: terms.split }
}

/** Why no token of this collection can be sold through this market; empty when they can. */
export function tradeBlocker(collection: Pick<NftCollection, "mode" | "markets">): string {
    if (collection.mode === "soulbound") return "Soulbound tokens are never sold."
    if (collection.mode === "royalty_protected" && !collection.markets.includes(NFT_MARKET_ADDRESS)) return "This collection's creator has not allowed this market, so its tokens cannot be sold here."
    return ""
}

/** A token as the ledger has it now, under the key every lane view reads it by. */
export function useToken(chainId: string, collection: string, number: bigint) {
    return useQuery({
        queryKey: ["nft", "ledger", "token", chainId, collection, number.toString()],
        queryFn: () => getToken(collection, number),
        staleTime: 60_000, retry: false,
    })
}
