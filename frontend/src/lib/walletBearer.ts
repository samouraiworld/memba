/**
 * Authorization header for the backend's REST routes that take the wallet
 * session token (GitHub OAuth state + exchange). The backend decodes the token
 * with the Go/proto field names (snake_case), so it is spelled out here rather
 * than JSON.stringify'd from the camelCase message.
 *
 * @module lib/walletBearer
 */
import type { Token } from "../gen/memba/v1/memba_pb"

export function walletBearer(token: Token): string {
    return `Bearer ${JSON.stringify({
        nonce: token.nonce,
        expiration: token.expiration,
        user_address: token.userAddress,
        server_signature: token.serverSignature,
        chain_id: token.chainId,
    })}`
}
