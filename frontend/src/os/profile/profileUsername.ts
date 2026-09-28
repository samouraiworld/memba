import { GNO_CHAIN_ID, getUsernameRegistrarPath } from "../../lib/config"
import { forgetRegisteredUsername, resolveUsernameToAddress } from "../../lib/dao/shared"
import { isValidGnoAddressChecksum } from "../../lib/dao/address"
import { doContractBroadcast } from "../../lib/grc20"
import { buildRegisterUsernameMsg, fetchRegisterPrice, nymNameProblem } from "../../lib/usernameRegistration"
import type { SignRequest } from "../sign/signer"

export function usernameLockKey(address: string): string { return `memba_username_register:${GNO_CHAIN_ID}:${address}` }

export async function usernameRegistrationRequest(address: string, name: string, onSettled: (outcome: string) => void): Promise<SignRequest> {
    if (!isValidGnoAddressChecksum(address)) throw new Error("Invalid wallet address.")
    const registrar = getUsernameRegistrarPath()
    if (!registrar) throw new Error("Username registration is unavailable on this network.")
    const problem = nymNameProblem(name)
    if (problem) throw new Error(problem)
    const price = await fetchRegisterPrice(registrar)
    if (price === null) throw new Error("The current registration price could not be read.")
    const msg = buildRegisterUsernameMsg(address, registrar, name, price)
    const key = usernameLockKey(address)
    return {
        title: "Register username",
        summary: `Register @${name}`,
        sub: `For ${address}`,
        lines: () => [["Username", `@${name}`], ["Account", address], ["Network", GNO_CHAIN_ID], ["Registrar", registrar], ["Registration price", `${price} ugnot`]],
        warns: ["A registered username is public and controlled by the registrar realm."],
        acks: ["I checked the username and current price."],
        note: "Adena shows a Register contract call and the network fee.",
        label: () => `Register @${name}`,
        prepare: () => ({ msgs: [msg] }),
        recheck: async () => {
            const current = await fetchRegisterPrice(registrar)
            if (current === null || current !== price) throw new Error("The registration price changed or could not be checked. Review again.")
            const owner = await resolveUsernameToAddress(name)
            if (owner === null) throw new Error("The username registry could not be checked. Nothing was sent.")
            if (owner !== "") throw new Error("That username is already registered. Nothing was sent.")
        },
        send: async (_choice, beforeSign) => {
            localStorage.setItem(key, JSON.stringify({ name, at: Date.now() }))
            return doContractBroadcast([msg], `Register @${name}`, { retry: false, beforeSign })
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
