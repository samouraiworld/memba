import { MEMBA_DAO } from "./config"
import type { AminoMsg } from "./grc20"

// amount/unitPrice/qty/costUgnot are bigint — both the token amount (base
// units, up to 10^18 scale for an 18-decimal token) and the ugnot cost can
// exceed Number.MAX_SAFE_INTEGER once scaled by decimals; a JS `number` would
// silently lose precision on a large order. See lib/grc20.ts's
// parseTokenAmount/formatTokenAmount, the callers' source of these values.

export function buildListTokensMsg(caller: string, symbol: string, amount: bigint, unitPrice: bigint): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: MEMBA_DAO.tokenOtcPath,
            func: "ListTokens",
            args: [symbol, amount.toString(), unitPrice.toString()],
        },
    }
}

export function buildCancelListingMsg(caller: string, listingId: string): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: MEMBA_DAO.tokenOtcPath,
            func: "CancelListing",
            args: [listingId],
        },
    }
}

export function buildFillListingMsg(caller: string, listingId: string, qty: bigint, expectedUnitPrice: bigint, costUgnot: bigint): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: `${costUgnot}ugnot`, // Exact payment must be sent
            pkg_path: MEMBA_DAO.tokenOtcPath,
            func: "Fill",
            args: [listingId, qty.toString(), expectedUnitPrice.toString()],
        },
    }
}
