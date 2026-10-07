/**
 * The Sign-In with Ethereum (EIP-4361) message for one server challenge
 * (GetSiweChallenge). The backend binds the message to its challenge field by
 * field, so every field is taken from it: domain, URI, chain, nonce, issued-at
 * and expiry; only the address is the wallet's, in its EIP-55 form.
 *
 * @module lib/chain/evm/siwe
 */
import { createSiweMessage } from "viem/siwe"

export interface SiweFrame {
    nonce: string
    /** CAIP-2: "eip155:84532". */
    chainId: string
    domain: string
    uri: string
    issuedAt: string
    expiration: string
    statement: string
}

export function buildSiweMessage(frame: SiweFrame, address: string): string {
    const m = /^eip155:(\d{1,18})$/.exec(frame.chainId)
    if (!m) throw new Error(`Not an EVM chain: ${frame.chainId}`)
    return createSiweMessage({
        domain: frame.domain,
        address: address as `0x${string}`,
        statement: frame.statement || undefined,
        uri: frame.uri,
        version: "1",
        chainId: Number(m[1]),
        nonce: frame.nonce,
        issuedAt: new Date(frame.issuedAt),
        expirationTime: new Date(frame.expiration),
    })
}
