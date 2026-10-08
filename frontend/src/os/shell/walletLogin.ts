/**
 * Wallet → Memba session: challenge, login signature, token. Memba OS and the
 * classic Layout (performLogin) both sign in through it, with the same hooks
 * (useAdena, useAuth).
 *
 * @module os/shell/walletLogin
 */
import type { Token } from "../../gen/memba/v1/memba_pb"
import { buildTokenRequestInfo, type LoginRefusal, type LoginSignature } from "../../lib/loginChallenge"
import { SESSION_ACCOUNT_LOGIN_MSG } from "../../lib/loginErrors"
import { assertLiveWalletNetwork } from "../../lib/walletNetworkGuard"
import { ADENA_CLOSED_MESSAGE, ADENA_NO_ANSWER_MESSAGE, type PromptWatch } from "../../lib/adenaCall"
import { startWalletFlow } from "../../lib/walletTiming"
import { chainPublicKey } from "../../lib/account"

export interface LoginWallet {
    connected: boolean
    address: string
    pubkeyJSON: string
    signLoginChallenge: (chainId: string, nonceBase64: string, watch?: PromptWatch) => Promise<LoginSignature | LoginRefusal>
}

export interface LoginAuth {
    getChallenge: (userPubkeyJson?: string, chainId?: string) => Promise<
        { nonce: Uint8Array; expiration: string; serverSignature: Uint8Array; boundPubkeyHash?: string; chainId?: string } | undefined
    >
    /** Null when the server refused the login without a code; rethrows the coded refusals and the server's failures. */
    getToken: (infoJson: string, userSignature: string) => Promise<Token | null | undefined>
}

// Protojson encodes bytes fields as base64.
function bytesToBase64(bytes: Uint8Array): string {
    let binary = ""
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
}

/**
 * Why the wallet can't sign in to `chainId` from the chain it is on, or null.
 * Adena signs the login message for its own network, whatever the message
 * names, so a login signed elsewhere can never verify.
 */
export function walletOnOtherChain(walletChainId: string, chainId: string): string | null {
    return walletChainId && walletChainId !== chainId ? `Adena is on ${walletChainId}, but Memba is on ${chainId}. Switch Adena to ${chainId} to sign in.` : null
}

/** What to tell the user when Adena returned no signature; "no-key" has none: it signs in by address instead. */
const REFUSALS: Record<Exclude<LoginRefusal, "no-key">, string> = {
    declined: "You declined the login message in Adena. Sign in again when you're ready.",
    "session-account": SESSION_ACCOUNT_LOGIN_MSG,
    unsupported: "This version of Adena can't sign Memba's login message. Update Adena, then sign in again.",
    "no-answer": ADENA_NO_ANSWER_MESSAGE,
    closed: ADENA_CLOSED_MESSAGE,
    failed: "Adena couldn't sign the login message. Try again.",
}

/**
 * Signs in the connected wallet. Returns the session token, or throws with a
 * message to show. Adena signs for the network it is on, so that is checked
 * live first (the challenge is fetched meanwhile). An account with no key on
 * that network can't sign (it never sent a transaction there): it asks by
 * address instead, and where signed
 * login is enforced the server answers AUTH-ACTIVATE-01, which the caller
 * turns into the activation step. When the wallet reported no key and the
 * chain confirms it has none, Adena is not asked at all: its window could
 * only fail with "Public key not found". No other refusal sends an unsigned
 * request.
 */
export async function signInWithWallet(wallet: LoginWallet, auth: LoginAuth, chainId: string, opts: { watch?: PromptWatch } = {}): Promise<Token> {
    if (!wallet.connected || !wallet.address) throw new Error("Connect your wallet first.")
    const flow = startWalletFlow("sign-in")
    flow.step("click")
    try {
        // Bound to the pubkey when the chain already knows it; bound to the chain always. Asked
        // while the wallet is checked: a refused check drops the nonce unused (it expires).
        const challengeAsked = auth.getChallenge(wallet.pubkeyJSON || undefined, chainId)
        challengeAsked.catch(() => { /* read below, unless the check refuses first */ })
        // Read while the wallet is checked. A failed read asks Adena, as for a key.
        const keyless = wallet.pubkeyJSON ? Promise.resolve(false) : chainPublicKey(wallet.address, chainId).then((key) => !key, () => false)
        await assertLiveWalletNetwork(chainId, { address: wallet.address })
        flow.step("guard")
        const challenge = await challengeAsked
        flow.step("challenge")
        if (!challenge) throw new Error("Memba couldn't start the sign-in. Try again in a moment.")

        const nonceB64 = bytesToBase64(challenge.nonce)
        const watch = opts.watch
        const signed = (await keyless) ? "no-key" as const : await wallet.signLoginChallenge(chainId, nonceB64, {
            ...watch,
            onSent: () => { flow.step("sign-sent"); watch?.onSent?.() },
            onPopupFocus: () => { flow.step("popup-focus"); watch?.onPopupFocus?.() },
        })
        flow.step("signed")
        if (typeof signed === "string" && signed !== "no-key") throw new Error(REFUSALS[signed])
        const signature = typeof signed === "string" ? "" : signed.signature
        // The key Adena signed with is authoritative; with no key on this network there is none.
        const pubkey = typeof signed === "string" ? "" : signed.pubKey || wallet.pubkeyJSON

        const info = buildTokenRequestInfo({
            nonceB64,
            expiration: challenge.expiration,
            serverSignatureB64: bytesToBase64(challenge.serverSignature),
            boundPubkeyHash: challenge.boundPubkeyHash || "",
            chainId: challenge.chainId || chainId,
            ...(pubkey ? { userPubkeyJson: pubkey } : { userAddress: wallet.address }),
        })

        const token = await auth.getToken(JSON.stringify(info), signature)
        if (!token) {
            throw new Error(Date.parse(challenge.expiration) <= Date.now()
                ? "The login message expired before Memba could check it. Sign in again."
                : `Memba couldn't verify this sign-in. Make sure Adena is on ${chainId}, then sign in again.`)
        }
        flow.end("token")
        return token
    } catch (err) {
        flow.end("refused")
        throw err
    }
}
