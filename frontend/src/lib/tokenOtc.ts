import { MEMBA_DAO } from "./config"
import type { AminoMsg } from "./grc20"

export function buildListTokensMsg(caller: string, symbol: string, amount: number, unitPrice: number): AminoMsg {
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

export function buildFillListingMsg(caller: string, listingId: string, qty: number, expectedUnitPrice: number, costUgnot: number): AminoMsg {
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
