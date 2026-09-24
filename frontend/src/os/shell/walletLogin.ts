/**
 * Wallet → Memba session: challenge, login signature, token. The same steps
 * and the same fallbacks as Layout's performLogin (components/layout/Layout.tsx),
 * which the current app keeps using; Memba OS runs outside that Layout, so it
 * calls this with the same hooks (useAdena, useAuth). Keep the two in step.
 *
 * @module os/shell/walletLogin
 */
import type { Token } from "../../gen/memba/v1/memba_pb"
import { buildTokenRequestInfo } from "../../lib/loginChallenge"

export interface LoginWallet {
    connected: boolean
    address: string
    pubkeyJSON: string
    signLoginChallenge: (chainId: string, nonceBase64: string) => Promise<{ signature: string; pubKey: string } | null>
}

export interface LoginAuth {
    getChallenge: (userPubkeyJson?: string, chainId?: string) => Promise<
        { nonce: Uint8Array; expiration: string; serverSignature: Uint8Array; boundPubkeyHash?: string; chainId?: string } | undefined
    >
    /** Rethrows the actionable login errors (activation, chain mismatch, session reject). */
    getToken: (infoJson: string, userSignature: string) => Promise<Token | null | undefined>
}

// Protojson encodes bytes fields as base64.
function bytesToBase64(bytes: Uint8Array): string {
    let binary = ""
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
}

/**
 * Signs in the connected wallet. Returns the session token, or throws with a
 * message to show. An untransacted wallet can't sign (Adena needs the key on
 * chain), so it falls back to an address-only request; where signed login is
 * enforced the server answers AUTH-ACTIVATE-01, which the caller turns into
 * the activation step.
 */
export async function signInWithWallet(wallet: LoginWallet, auth: LoginAuth, chainId: string): Promise<Token> {
    if (!wallet.connected || !wallet.address) throw new Error("Connect your wallet first.")

    // Bound to the pubkey when the chain already knows it; bound to the chain always.
    const challenge = await auth.getChallenge(wallet.pubkeyJSON || undefined, chainId)
    if (!challenge) throw new Error("Memba couldn't start the sign-in. Try again in a moment.")

    const nonceB64 = bytesToBase64(challenge.nonce)
    const signed = await wallet.signLoginChallenge(chainId, nonceB64)
    let signature = ""
    let pubkey = wallet.pubkeyJSON || ""
    if (signed) {
        signature = signed.signature
        if (signed.pubKey) pubkey = signed.pubKey // the key Adena signed with is authoritative
    }

    const info = buildTokenRequestInfo({
        nonceB64,
        expiration: challenge.expiration,
        serverSignatureB64: bytesToBase64(challenge.serverSignature),
        boundPubkeyHash: challenge.boundPubkeyHash || "",
        chainId: challenge.chainId || chainId,
        ...(pubkey ? { userPubkeyJson: pubkey } : { userAddress: wallet.address }),
    })

    const token = await auth.getToken(JSON.stringify(info), signature)
    if (!token) throw new Error("Sign-in failed. Try again.")
    return token
}
