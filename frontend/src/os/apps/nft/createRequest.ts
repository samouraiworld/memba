/**
 * Creating a collection goes through the OS review sheet. The sheet shows the
 * terms and the collection fee read when the creator asked; right before the
 * wallet opens the lane, the fee, the symbol and the royalty receivers are
 * read again, and any change stops the signature.
 *
 * @module os/apps/nft/createRequest
 */
import { isNftEnabled, isRealmValidOn } from "../../../lib/config"
import { isValidGnoAddressChecksum } from "../../../lib/dao/address"
import { depositCapUgnot, formatUgnot, formatUgnotExact } from "../../../lib/dao/v2Budget"
import { revealInvisibleFormatting } from "../../../lib/dao/v2Text"
import { assertFeeStillCovers, doContractBroadcast, feeForGasWanted, freshFeeForGasWanted, type GasPrice } from "../../../lib/grc20"
import {
    CREATE_COLLECTION_STORAGE_BYTES, buildCreateCollectionMsg, createCollectionGasWanted, isUnspendable, type CollectionTerms,
} from "../../../lib/nft/create"
import { NFT_DROPS_PATH, getDropTerms } from "../../../lib/nft/drops"
import { formatAmount, formatBPS } from "../../../lib/nft/format"
import { laneClosedReason, readActionStatus, readReserved } from "../../../lib/tokenLaunchpadConfigClient"
import type { SettledOutcome, SignRequest } from "../../sign/signer"
import { verifySendTx } from "../../wallet/sendRequest"

export interface CreateDraft {
    terms: CollectionTerms
    /** The collection fee in GNOT as read when the creator asked. */
    fee: bigint
    caller: string
    networkKey: string
    chainId: string
    gas: GasPrice
    onSettled?: (outcome: SettledOutcome) => void
}

const MODE: Record<CollectionTerms["mode"], string> = {
    open: "Transferable: holders move and sell their tokens freely",
    royalty_protected: "Royalty-protected: tokens move only through a market the collection allows, which pays its royalties",
    soulbound: "Soulbound: tokens never move and are never sold",
}

/** The terms the drops realm reads for a creation, before the wallet: the lane, the fee, the symbol and every royalty receiver. */
export async function assertCreatable(networkKey: string, terms: CollectionTerms, fee: bigint): Promise<void> {
    const [lane, drop, reserved, refused] = await Promise.all([
        readActionStatus(networkKey, "collection", "ugnot"),
        getDropTerms("ugnot"),
        readReserved(networkKey, terms.symbol),
        Promise.all(terms.royalties.map((royalty) => isUnspendable(royalty.account))),
    ])
    if (!lane.open) throw new Error(laneClosedReason(lane, "Creating a collection"))
    if (drop.collectionFee === null) throw new Error("Creating a collection in GNOT is not open on this network.")
    if (drop.collectionFee !== fee) throw new Error(`The collection fee is now ${formatAmount(drop.collectionFee, "ugnot")}.`)
    if (reserved) throw new Error(`The symbol ${terms.symbol} is reserved on this network.`)
    const receiver = terms.royalties.find((_, index) => refused[index])
    if (receiver) throw new Error(`${receiver.account} cannot receive royalties: it is a Launchpad realm.`)
}

export function createCollectionRequest(draft: CreateDraft): SignRequest {
    if (!isNftEnabled() || !isRealmValidOn(draft.networkKey, NFT_DROPS_PATH)) throw new Error("Creating a collection is not available on this network.")
    if (!isValidGnoAddressChecksum(draft.caller)) throw new Error("Connect your wallet before creating a collection.")
    const { terms } = draft
    const msg = buildCreateCollectionMsg(draft.caller, terms, draft.fee)
    const gasWanted = createCollectionGasWanted(terms)
    const fee = feeForGasWanted(gasWanted, draft.gas)
    const label = `Create ${terms.symbol}`
    // Memba loads collection art from IPFS only: an https link is signed as it is, but never shown.
    const link = (value: string) => value === "" ? "None"
        : value.startsWith("https://") ? `${value} (Memba will not load this image; use ipfs://)` : value
    const royalties = terms.royalties.length === 0 ? "None"
        : terms.royalties.map((royalty) => `${formatBPS(royalty.bps)} to ${royalty.account}`).join("; ")
    return {
        title: "Create collection",
        summary: `Create ${revealInvisibleFormatting(terms.name)} (${terms.symbol})`,
        sub: "A new collection on the Launchpad NFT ledger",
        lines: () => [
            ["Creator", draft.caller],
            ["Name and symbol", `${revealInvisibleFormatting(terms.name)} · ${terms.symbol}`],
            ["Description", terms.description === "" ? "None" : revealInvisibleFormatting(terms.description)],
            ["Image", link(terms.image)],
            ["Banner", link(terms.banner)],
            ["Website", terms.website === "" ? "None" : terms.website],
            ["Mode", MODE[terms.mode]],
            ...(terms.mode === "soulbound" ? [["Revocable", terms.revocable ? "Yes: you may revoke a token" : "No"] as [string, string]] : []),
            ["Supply", terms.maxSupply === 0n ? "Open edition: no maximum" : `At most ${terms.maxSupply} tokens`],
            ["Metadata", terms.metadataMode === "static" ? `${terms.baseURI}, fixed for good` : `${terms.baseURI}, changeable until you freeze it`],
            ["Royalties", royalties],
            ["Collection fee", `${formatAmount(draft.fee, "ugnot")} to the Launchpad treasury`],
            ["Drops realm", NFT_DROPS_PATH],
            ["Network", draft.chainId],
            ["Storage deposit", `Up to ${formatUgnot(depositCapUgnot(CREATE_COLLECTION_STORAGE_BYTES))}, locked with the collection`],
            ["Network fee", formatUgnotExact(fee)],
        ],
        acks: ["I understand that the name, symbol, mode, maximum supply and royalties can never change."],
        note: "The description, image, banner and website can change until you freeze the profile. Minting starts with a stage you schedule in the studio.",
        label: () => label,
        prepare: () => ({ msgs: [msg] }),
        recheck: async () => {
            await assertCreatable(draft.networkKey, terms, draft.fee).catch((err: unknown) => {
                const message = err instanceof Error ? err.message : String(err)
                throw new Error(`${message.replace(/\.?$/, ".")} Nothing was sent.`)
            })
            await assertFeeStillCovers(fee, () => freshFeeForGasWanted(gasWanted))
        },
        send: (_choice, beforeSign) => doContractBroadcast([msg], label, { gasWanted, gasFee: fee, beforeSign }),
        verify: (_choice, hash) => verifySendTx(hash),
        onSettled: draft.onSettled,
    }
}
