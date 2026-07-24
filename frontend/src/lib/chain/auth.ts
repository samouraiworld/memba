/**
 * Chain Abstraction Layer (CAL) — Auth Abstraction
 *
 * Provides chain-agnostic authentication primitives. The backend verifier
 * accepts both Gno (ADR-036 / tx-shaped SignMultisigTransaction) and EVM
 * (SIWE / EIP-4361) login proofs.
 *
 * Flow:
 * 1. Frontend requests a challenge from backend: `GET /auth/challenge`
 * 2. Frontend signs the challenge with the chain-specific method
 * 3. Frontend sends the signed proof to backend: `POST /auth/login`
 * 4. Backend verifies and returns a JWT
 *
 * @module lib/chain/auth
 */

import type { ChainFamily, ChainAddress } from "../types"

// ── Auth Types ───────────────────────────────────────────────

/** A server-issued login challenge. */
export interface LoginChallenge {
    /** Unique nonce (base64 for Gno, hex for EVM). */
    nonce: string
    /** Challenge expiration (ISO 8601). */
    expiresAt: string
    /** Server signature over the challenge (anti-forge). */
    serverSignature: string
    /** Bound public key hash (anti-replay). */
    boundPubkeyHash?: string
    /** Chain ID the challenge is bound to. */
    chainId: string
}

/** A signed login proof, ready for the backend to verify. */
export interface LoginProof {
    /** Which chain family signed this proof. */
    family: ChainFamily
    /** The signer's address. */
    address: ChainAddress
    /** The signed data (base64 for Gno, hex for EVM). */
    signature: string
    /** Chain ID the proof is bound to. */
    chainId: string

    // ── Gno-specific fields ──
    /** ADR-036 / tx-shaped sign doc (Gno only). */
    signDoc?: unknown
    /** Amino-encoded public key JSON (Gno only, for untransacted wallets). */
    pubkeyJSON?: string

    // ── EVM-specific fields ──
    /** SIWE message that was signed (EVM only). */
    siweMessage?: string
}

/** The result of a successful login. */
export interface AuthResult {
    /** JWT access token. */
    token: string
    /** Token expiration (ISO 8601). */
    expiresAt: string
    /** The authenticated address. */
    address: ChainAddress
}

// ── Auth Strategy Interface ──────────────────────────────────

/**
 * Chain-specific auth strategy.
 *
 * Implementations:
 * - GnoAuthStrategy: builds ADR-036 sign doc, signs via Adena
 * - EvmAuthStrategy: builds SIWE message, signs via wagmi/viem
 */
export interface AuthStrategy {
    /** Which chain family this strategy handles. */
    readonly family: ChainFamily

    /**
     * Build and sign the login challenge.
     *
     * @param challenge - Server-issued challenge
     * @param address - The address to authenticate
     * @returns LoginProof ready for backend verification
     */
    sign(challenge: LoginChallenge, address: ChainAddress): Promise<LoginProof>
}

// ── SIWE Message Builder (EVM) ───────────────────────────────

/**
 * Build a SIWE (EIP-4361) message for EVM authentication.
 *
 * Format spec: https://eips.ethereum.org/EIPS/eip-4361
 *
 * @example
 * ```
 * memba.app wants you to sign in with your Ethereum account:
 * 0x1234...abcd
 *
 * Sign in to Memba
 *
 * URI: https://memba.app
 * Version: 1
 * Chain ID: 4663
 * Nonce: abc123
 * Issued At: 2026-07-24T00:00:00Z
 * Expiration Time: 2026-07-24T01:00:00Z
 * ```
 */
export function buildSiweMessage(opts: {
    domain: string
    address: string
    uri: string
    chainId: number
    nonce: string
    issuedAt: string
    expirationTime: string
    statement?: string
}): string {
    const statement = opts.statement || "Sign in to Memba"
    return [
        `${opts.domain} wants you to sign in with your Ethereum account:`,
        opts.address,
        "",
        statement,
        "",
        `URI: ${opts.uri}`,
        `Version: 1`,
        `Chain ID: ${opts.chainId}`,
        `Nonce: ${opts.nonce}`,
        `Issued At: ${opts.issuedAt}`,
        `Expiration Time: ${opts.expirationTime}`,
    ].join("\n")
}

// ── Gno Auth Constants (re-exported for strategy implementations) ─

export {
    CLIENT_MAGIC,
    LOGIN_PKG_PATH,
    LOGIN_FUNC,
    loginChallengeMemo,
    buildLoginChallengeDoc,
    adenaPubKeyToJSON,
    buildTokenRequestInfo,
} from "../../loginChallenge"
