// A2.phase1 — tx-shaped login proof (Adena has no ADR-036, only tx-shaped signing).
//
// The user signs a NON-BROADCAST, tx-shaped sentinel /vm.m_call via Adena's
// SignMultisigTransaction; the backend reconstructs the SAME doc and verifies the
// signature over gno-canonical sign-bytes (CanonicalSignBytes / LoginChallengeSignBytes).
//
// This doc MUST stay byte-identical to the backend template in
// backend/internal/auth/login_challenge.go — any divergence makes the signature
// fail verification. See docs/planning/MEMBA_AAA_A2A3_SIGNBYTES_DESIGN.md §5 (A2).

// CLIENT_MAGIC is the anti-phishing intent string; it must equal the backend
// auth.ClientMagic and is the memo prefix of the login challenge.
export const CLIENT_MAGIC = "Login to Memba Multisig Service"

// Sentinel realm/func — intentionally never deployed, so the challenge can never be
// broadcast as a meaningful transaction. Must match backend auth.LoginPkgPath/LoginFunc.
export const LOGIN_PKG_PATH = "gno.land/r/memba/login"
export const LOGIN_FUNC = "ProveKeyOwnership"

// loginChallengeMemo binds the signature to one server challenge (anti-replay) and
// shows readable intent in the wallet prompt. Must match backend LoginChallengeMemo:
// `${ClientMagic} | nonce: ${base64(nonce)}`.
export function loginChallengeMemo(nonceBase64: string): string {
    return `${CLIENT_MAGIC} | nonce: ${nonceBase64}`
}

// adenaPubKeyToJSON converts the pubkey from Adena's sign response
// ({"@type":"/tm.PubKeySecp256k1", value}) into the backend's expected
// ParsePubKeyJSON form ({"type":"tendermint/PubKeySecp256k1", value}). Used so
// untransacted wallets (no on-chain pubkey) can authenticate via the sign-response
// pubkey. See design §9.
export function adenaPubKeyToJSON(value: string): string {
    return JSON.stringify({ type: "tendermint/PubKeySecp256k1", value })
}

/** Adena SignMultisigTransaction document for the login challenge. */
export interface LoginChallengeDoc {
    tx: {
        msg: Array<Record<string, unknown>>
        fee: { gas_wanted: string; gas_fee: string }
        signatures: null
        memo: string
    }
    chainId: string
    accountNumber: string
    sequence: string
}

// buildLoginChallengeDoc constructs the exact doc Adena signs. account_number,
// sequence and fee are zero (non-broadcastable); args is OMITTED to match gno's
// MsgCall omitempty canonical form. nonceBase64 is the standard-base64 challenge
// nonce (the same encoding the backend uses).
//
// buildTokenRequestInfo builds the protojson TokenRequestInfo the backend's
// MakeToken consumes. CRITICAL: the challenge must be echoed back with ALL the
// server-signed fields — including chainId — or ValidateChallenge's server-signature
// check fails (a dropped challenge.chainId caused a GetToken 403 login outage).
// chainId is set on BOTH info.chainId and info.challenge.chainId so the backend's
// effectiveChainID matches the challenge binding (AUTH-CHAINID-01).
export function buildTokenRequestInfo(opts: {
    nonceB64: string
    expiration: string
    serverSignatureB64: string
    boundPubkeyHash: string
    chainId: string
    userPubkeyJson?: string
    userAddress?: string
}): Record<string, unknown> {
    const info: Record<string, unknown> = {
        kind: CLIENT_MAGIC,
        challenge: {
            nonce: opts.nonceB64,
            expiration: opts.expiration,
            serverSignature: opts.serverSignatureB64,
            boundPubkeyHash: opts.boundPubkeyHash,
            chainId: opts.chainId,
        },
        userBech32Prefix: "g",
        chainId: opts.chainId,
    }
    if (opts.userPubkeyJson) {
        info.userPubkeyJson = opts.userPubkeyJson
    } else if (opts.userAddress) {
        info.userAddress = opts.userAddress
    }
    return info
}

export function buildLoginChallengeDoc(
    chainId: string,
    address: string,
    nonceBase64: string,
): LoginChallengeDoc {
    return {
        tx: {
            msg: [
                {
                    "@type": "/vm.m_call",
                    // args:null (not omitted, not []) to match Adena's proto-roundtrip
                    // form and the backend LoginChallengeSignBytes. See design §9.
                    args: null,
                    caller: address,
                    send: "",
                    max_deposit: "",
                    pkg_path: LOGIN_PKG_PATH,
                    func: LOGIN_FUNC,
                },
            ],
            fee: { gas_wanted: "0", gas_fee: "" },
            signatures: null,
            memo: loginChallengeMemo(nonceBase64),
        },
        chainId,
        accountNumber: "0",
        sequence: "0",
    }
}
