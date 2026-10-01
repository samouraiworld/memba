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

export interface LoginWallet {
    connected: boolean
    address: string
    pubkeyJSON: string
    signLoginChallenge: (chainId: string, nonceBase64: string) => Promise<LoginSignature | LoginRefusal>
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
    failed: "Adena couldn't sign the login message. Try again.",
}

/**
 * Signs in the connected wallet. Returns the session token, or throws with a
 * message to show. Adena signs for the network it is on, so that is checked
 * live first. An account with no key on that network can't sign (it never
 * sent a transaction there): it asks by address instead, and where signed
 * login is enforced the server answers AUTH-ACTIVATE-01, which the caller
 * turns into the activation step. No other refusal sends an unsigned request.
 */
export async function signInWithWallet(wallet: LoginWallet, auth: LoginAuth, chainId: string): Promise<Token> {
    if (!wallet.connected || !wallet.address) throw new Error("Connect your wallet first.")
    await assertLiveWalletNetwork(chainId, { address: wallet.address })

    // Bound to the pubkey when the chain already knows it; bound to the chain always.
    const challenge = await auth.getChallenge(wallet.pubkeyJSON || undefined, chainId)
    if (!challenge) throw new Error("Memba couldn't start the sign-in. Try again in a moment.")

    const nonceB64 = bytesToBase64(challenge.nonce)
    const signed = await wallet.signLoginChallenge(chainId, nonceB64)
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
    return token
}
