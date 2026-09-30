import { GNO_CHAIN_ID, getUsernameRegistrarPath } from "../../lib/config"
import { forgetRegisteredUsername, resolveUsernameToAddress } from "../../lib/dao/shared"
import { isValidGnoAddressChecksum } from "../../lib/dao/address"
import { formatUgnotExact } from "../../lib/dao/v2Budget"
import { assertFeeStillCovers, doContractBroadcast, freshFeeForGasWanted, type GasPrice } from "../../lib/grc20"
import { buildRegisterUsernameMsg, fetchRegisterPrice, nymNameProblem, REGISTER_DEPOSIT_UGNOT, REGISTER_MAX_DEPOSIT_UGNOT, registerBroadcastOptions } from "../../lib/usernameRegistration"
import type { SignRequest } from "../sign/signer"
import { formatUgnot } from "../wallet/send"

export function usernameLockKey(address: string): string { return `memba_username_register:${GNO_CHAIN_ID}:${address}` }

export async function usernameRegistrationRequest(address: string, name: string, gasPrice: GasPrice, onSettled: (outcome: string) => void): Promise<SignRequest> {
    if (!isValidGnoAddressChecksum(address)) throw new Error("Invalid wallet address.")
    const registrar = getUsernameRegistrarPath()
    if (!registrar) throw new Error("Username registration is unavailable on this network.")
    const problem = nymNameProblem(name)
    if (problem) throw new Error(problem)
    const price = await fetchRegisterPrice(registrar)
    if (price === null) throw new Error("The current registration price could not be read.")
    const msg = buildRegisterUsernameMsg(address, registrar, name, price)
    const options = registerBroadcastOptions(gasPrice)
    const key = usernameLockKey(address)
    return {
        title: "Register username",
        summary: `Register @${name}`,
        sub: `For ${address}`,
        lines: () => [
            ["Username", `@${name}`], ["Account", address], ["Network", GNO_CHAIN_ID], ["Registrar", registrar],
            ["Registration price", price === 0n ? "Free" : formatUgnot(price)],
            ["Storage deposit", `≈ ${formatUgnotExact(REGISTER_DEPOSIT_UGNOT)} (cap ${formatUgnotExact(REGISTER_MAX_DEPOSIT_UGNOT)}), not returned`],
            ["Network fee", formatUgnotExact(options.gasFee)],
        ],
        warns: ["A registered username is public and controlled by the registrar realm."],
        acks: ["I checked the username and the costs."],
        note: "Adena shows a Register contract call. The storage deposit is locked permanently: a registered name cannot be removed, so it is not returned.",
        label: () => `Register @${name}`,
        prepare: () => ({ msgs: [msg] }),
        recheck: async () => {
            const current = await fetchRegisterPrice(registrar)
            if (current === null || current !== price) throw new Error("The registration price changed or could not be checked. Review again.")
            const owner = await resolveUsernameToAddress(name)
            if (owner === null) throw new Error("The username registry could not be checked. Nothing was sent.")
            if (owner !== "") throw new Error("That username is already registered. Nothing was sent.")
            await assertFeeStillCovers(options.gasFee, () => freshFeeForGasWanted(options.gasWanted))
        },
        send: async (_choice, beforeSign) => {
            localStorage.setItem(key, JSON.stringify({ name, at: Date.now() }))
            return doContractBroadcast([msg], `Register @${name}`, { ...options, beforeSign })
        },
        verify: async () => (await resolveUsernameToAddress(name)) === address,
        onNothingSent: () => localStorage.removeItem(key),
        onSettled: (outcome) => {
            if (outcome === "confirmed") {
                localStorage.removeItem(key)
                forgetRegisteredUsername(address)
            }
            onSettled(outcome)
        },
    }
}
