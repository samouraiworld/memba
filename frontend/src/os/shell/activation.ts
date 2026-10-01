/**
 * Activation signed through the OS review sheet. The message and its costs are
 * lib/activation's, shared with the classic dialog.
 *
 * @module os/shell/activation
 */
import { assertFeeStillCovers, doContractBroadcast, freshFeeForGasWanted, type GasPrice } from "../../lib/grc20"
import { ACTIVATION_MEMO, activationCosts, activationMsgs } from "../../lib/activation"
import type { SignRequest } from "../sign/signer"

/**
 * Signed through the OS path: the reviewed message is the one sent. Memba asks Adena for the reviewed
 * fee, re-priced right before Adena opens; Adena may set its own from its gas estimate.
 */
export function activationRequest(address: string, price: GasPrice): SignRequest<string> {
    const msgs = activationMsgs(address)
    const { gasWanted, feeUgnot } = activationCosts(price)
    return {
        title: "Activate", summary: "Activate your address", lines: () => [], label: () => "Activate your address",
        prepare: () => ({ msgs }),
        recheck: () => assertFeeStillCovers(feeUgnot, () => freshFeeForGasWanted(gasWanted)),
        send: (_c, beforeSign) => doContractBroadcast(msgs, ACTIVATION_MEMO, { osActivation: true, gasWanted, gasFee: feeUgnot, beforeSign }),
    }
}
