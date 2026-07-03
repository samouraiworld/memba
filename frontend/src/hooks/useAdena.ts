import { useState, useCallback, useEffect, useRef } from "react";
import { isTrustedRpcDomain, networkScopedKey } from "../lib/config";
import { setWalletRpcContext, UNVERIFIED_CHAIN_ID } from "../lib/grc20";
import { buildAdenaMultisigDoc, type CanonicalSignDoc } from "../lib/multisigTx";
import { trackEvent } from "../lib/analytics";
import { buildLoginChallengeDoc, adenaPubKeyToJSON } from "../lib/loginChallenge";
import { logWalletEvent, installWalletLogDump } from "../lib/walletDebug";

// Adena injects `window.adena` when the extension is installed.
// API methods: AddEstablish, GetAccount, DoContract, Sign, SignTx,
// CreateMultisigAccount, CreateMultisigTransaction, SignMultisigTransaction,
// BroadcastMultisigTransaction, AddNetwork, SwitchNetwork, GetNetwork, On
// Source: adena-wallet/packages/adena-extension/src/inject.ts

interface AdenaAccount {
    status: string;
    data: {
        address: string;
        coins: string;
        publicKey: {
            "@type": string;
            value: string;
        };
        accountNumber: string;
        sequence: string;
        chainId: string;
    };
}

interface AdenaState {
    connected: boolean;
    address: string;
    pubkeyJSON: string;
    chainId: string;
    loading: boolean;
    reconnecting: boolean;
    error: string | null;
    /** Wallet's active RPC URL (from Adena GetNetwork). */
    rpcUrl: string;
    /** Whether the wallet's RPC URL is trusted (validated against allowlist). */
    rpcTrusted: boolean;
}

// W5.1: connection persistence moved sessionStorage → localStorage. The
// sessionStorage flag was PER-TAB: every new tab and every browser restart
// dropped the flag, so no silent reconnect was even attempted — the single
// biggest source of "Memba keeps disconnecting" reports. localStorage is no
// weaker a posture than the status quo (the auth token already lives there,
// FE-1), and the flag only authorizes a SILENT GetAccount() — Adena still
// gates it on the user's prior whitelist approval.
const SESSION_KEY = "memba_adena_connected";
// W2.2: the cached RPC url+trust verdict is chain-derived — a trust flag
// cached while the app targeted test12 must not be served as current after
// a switch to test13 (it would skip re-validation on reconnect).
const SESSION_RPC_KEY = networkScopedKey("memba_adena_rpc");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getAdena(): any {
    return (window as unknown as Record<string, unknown>).adena;
}

function wasConnected(): boolean {
    try {
        if (localStorage.getItem(SESSION_KEY) === "true") return true;
        // Migration: honor a legacy per-tab flag once, then promote it.
        if (sessionStorage.getItem(SESSION_KEY) === "true") {
            localStorage.setItem(SESSION_KEY, "true");
            return true;
        }
        return false;
    } catch { return false; }
}
function saveConnected() {
    try { localStorage.setItem(SESSION_KEY, "true"); } catch { /* no-op */ }
}
function clearConnected() {
    try {
        localStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(SESSION_KEY); // legacy flag
        sessionStorage.removeItem(SESSION_RPC_KEY);
    } catch { /* no-op */ }
}

/** Cache GetNetwork result for faster reconnect. */
function getCachedRpc(): { url: string; trusted: boolean } | null {
    try {
        const raw = sessionStorage.getItem(SESSION_RPC_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch { return null; }
}
function setCachedRpc(url: string, trusted: boolean) {
    try { sessionStorage.setItem(SESSION_RPC_KEY, JSON.stringify({ url, trusted })); } catch { /* no-op */ }
}

export function useAdena() {
    const [installed, setInstalled] = useState(() => !!getAdena());
    const [state, setState] = useState<AdenaState>({
        connected: false,
        address: "",
        pubkeyJSON: "",
        chainId: "",
        loading: false,
        reconnecting: wasConnected(), // true if we expect to auto-reconnect
        error: null,
        rpcUrl: "",
        rpcTrusted: false, // strict: untrusted until GetNetwork verifies
    });
    const autoReconnectAttempted = useRef(false);
    // Live view of state for event handlers registered once (visibility retry).
    const stateRef = useRef(state);
    stateRef.current = state;

    // Extensions inject globals after page load — poll to detect.
    // Adena can take up to 5-10s depending on browser load.
    useEffect(() => {
        if (installed) return;

        // Check immediately
        if (getAdena()) { setInstalled(true); return; }

        let stopped = false;
        let attempts = 0;

        // Poll every 200ms for up to 5s (was 10s — extension usually injects in 1–3s)
        const timer = setInterval(() => {
            if (getAdena()) { setInstalled(true); stopped = true; clearInterval(timer); }
            if (++attempts >= 25) clearInterval(timer);
        }, 200);

        // Detect when user returns to this tab (extension may have loaded meanwhile)
        const onVisibility = () => {
            if (!document.hidden && !stopped && getAdena()) setInstalled(true);
        };
        document.addEventListener("visibilitychange", onVisibility);

        // Fallback: window.load fires after all resources (extensions may inject then)
        const onLoad = () => { if (getAdena()) setInstalled(true); };
        window.addEventListener("load", onLoad);

        return () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisibility);
            window.removeEventListener("load", onLoad);
        };
    }, [installed]);

    const connect = useCallback(async (opts?: { silent?: boolean }) => {
        const adena = getAdena();
        if (!adena) {
            setState((s) => ({ ...s, error: "Adena wallet not installed" }));
            return false;
        }

        setState((s) => ({ ...s, loading: true, error: null }));

        try {
            // Silent reconnect: try GetAccount() first — if the user already
            // whitelisted Memba, this succeeds without showing a popup.
            let accountRes: AdenaAccount | null = null;
            try {
                const silentCheck: AdenaAccount = await adena.GetAccount();
                if (silentCheck.status !== "failure" && silentCheck.data?.address) {
                    accountRes = silentCheck;
                }
            } catch { /* silent check failed — wallet may be locked */ }

            if (!accountRes) {
                // In silent mode, don't show the Adena popup — just give up.
                // The user can browse freely and connect manually when needed.
                if (opts?.silent) {
                    logWalletEvent("silent-check-failed", "wallet locked or not whitelisted");
                    setState((s) => ({ ...s, loading: false, reconnecting: false }));
                    return false;
                }
                // Full establish flow — shows Adena approval popup (interactive only)
                const connectRes = await adena.AddEstablish("Memba");
                if (connectRes.status === "failure" && connectRes.type !== "ALREADY_CONNECTED") {
                    setState((s) => ({ ...s, loading: false, error: "Connection rejected" }));
                    return false;
                }
                accountRes = await adena.GetAccount();
            }

            // Validate account
            if (!accountRes || accountRes.status === "failure") {
                setState((s) => ({ ...s, loading: false, error: "Failed to get account" }));
                return false;
            }

            const { address, publicKey, chainId } = accountRes.data;

            // Public key may be null for accounts that haven't transacted on-chain yet.
            // In that case, connect with address-only — auth will use the direct address path.
            let pubkeyJSON = "";
            if (publicKey?.value) {
                pubkeyJSON = JSON.stringify({
                    type: "tendermint/PubKeySecp256k1",
                    value: publicKey.value,
                });
            }

            saveConnected();
            trackEvent("Wallet Connected");
            logWalletEvent("connected", opts?.silent ? "silent" : "interactive");

            // SECURITY: Read wallet's active RPC URL via GetNetwork()
            let rpcUrl = "";
            let rpcTrusted = false;
            try {
                if (typeof adena.GetNetwork === "function") {
                    const netRes = await adena.GetNetwork();
                    rpcUrl = netRes?.data?.rpcUrl || "";
                    rpcTrusted = rpcUrl ? isTrustedRpcDomain(rpcUrl) : false;
                    setCachedRpc(rpcUrl, rpcTrusted);
                } else {
                    // GetNetwork unavailable → try cached value from previous session
                    const cached = getCachedRpc();
                    if (cached) { rpcUrl = cached.url; rpcTrusted = cached.trusted; }
                }
            } catch {
                // GetNetwork failed → try cached, else strict: untrusted
                const cached = getCachedRpc();
                if (cached) { rpcUrl = cached.url; rpcTrusted = cached.trusted; }
            }
            setWalletRpcContext(rpcUrl || null, rpcTrusted, chainId || null);

            setState({
                connected: true,
                address,
                pubkeyJSON,
                chainId,
                loading: false,
                reconnecting: false,
                error: null,
                rpcUrl,
                rpcTrusted,
            });
            return true;
        } catch (err) {
            logWalletEvent("connect-error", err instanceof Error ? err.message : "unknown");
            console.error("[Memba] Connect error:", err);
            setState((s) => ({
                ...s,
                loading: false,
                error: err instanceof Error ? err.message : "Connection failed",
            }));
            return false;
        }
    }, []);

    // Auto-reconnect: if sessionStorage flag exists and Adena is installed,
    // attempt silent reconnect (no popup). If wallet is locked or not
    // whitelisted, silently give up — user can connect manually when needed.
    useEffect(() => {
        if (!installed || autoReconnectAttempted.current) return;
        if (!wasConnected()) {
            setState((s) => ({ ...s, reconnecting: false }));
            return;
        }
        autoReconnectAttempted.current = true;
        installWalletLogDump();
        logWalletEvent("silent-reconnect", "mount");
        connect({ silent: true }).then((ok) => {
            logWalletEvent("silent-reconnect-result", ok ? "connected" : "gave-up");
        }).finally(() => {
            setState((s) => ({ ...s, reconnecting: false }));
        });
    }, [installed, connect]);

    // W5.1: the mount-time silent reconnect is one-shot — if it ran while the
    // wallet was LOCKED (typical right after a browser restart), the tab stayed
    // disconnected forever even after the user unlocked Adena. Retry the silent
    // reconnect when the tab becomes visible again, throttled to one attempt
    // per 15s, only while we still expect to be connected.
    const lastVisibilityRetry = useRef(0);
    useEffect(() => {
        if (!installed) return;
        const onVisible = () => {
            if (document.hidden) return;
            if (stateRef.current.connected || stateRef.current.loading) return;
            if (!wasConnected()) return;
            const now = Date.now();
            if (now - lastVisibilityRetry.current < 15_000) return;
            lastVisibilityRetry.current = now;
            logWalletEvent("silent-reconnect", "tab-visible retry");
            connect({ silent: true }).then((ok) => {
                logWalletEvent("silent-reconnect-result", ok ? "connected" : "gave-up");
            });
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => document.removeEventListener("visibilitychange", onVisible);
    }, [installed, connect]);

    /** Sign a multisig transaction via Adena's SignMultisigTransaction().
     *  Input: JSON string of Amino sign doc from buildSignDoc().
     *  Returns: base64 signature string, or null on failure.
     *
     *  Adena's Sign() uses the signer's own account (wrong for multisig).
     *  SignMultisigTransaction() correctly signs with the multisig's
     *  account_number and sequence. */
    const signArbitrary = useCallback(
        async (data: string): Promise<string | null> => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const adena = getAdena() as any;
            if (!adena || !state.connected) return null;

            try {
                // The stored doc is already canonical (see lib/multisigTx +
                // ProposeTransaction): msgs are @type-inlined and fee is
                // {gas_wanted,gas_fee}. Adena signs it AS-IS via SignMultisigTransaction,
                // so the member signature is over the exact doc the backend A3 verifier
                // reconstructs. (Previously this re-converted from a cosmos {amount,gas} /
                // {type,value} shape, which diverged from what ProposeTransaction stores.)
                const parsed = JSON.parse(data) as CanonicalSignDoc;
                const multisigDoc = buildAdenaMultisigDoc(parsed);

                // Try SignMultisigTransaction first (correct for multisig)
                if (typeof adena.SignMultisigTransaction === "function") {
                    const res = await adena.SignMultisigTransaction(multisigDoc);
                    if (res.status !== "failure") {
                        const sig = res.data?.signature?.signature;
                        if (sig) return sig;
                    }
                }

                // No fallback to adena.Sign(): it signs with the SIGNER's own account
                // (not the multisig's account_number/sequence), producing a signature
                // over different bytes that can NEVER verify against the multisig
                // sign-doc — storing it would be a silent, permanently-invalid sig that
                // only surfaces when A3 enforcement is flipped. Fail loudly instead
                // (TransactionView shows "Signature rejected").
                return null;
            } catch (err) {
                console.error("[Memba] Sign error:", err);
                return null;
            }
        },
        [state.connected]
    );

    /** A2 login proof — sign the non-broadcast, tx-shaped login challenge
     *  (sentinel /vm.m_call, nonce in memo) via Adena's SignMultisigTransaction.
     *  The doc is byte-identical to the backend's LoginChallengeSignBytes; the
     *  backend reconstructs + verifies it. Returns the base64 signature AND the
     *  signer's pubkey (from the sign response) — the latter lets untransacted
     *  wallets (no on-chain pubkey) authenticate by proving key ownership. Returns
     *  null if the wallet is unavailable / rejects / lacks the primitive. */
    const signLoginChallenge = useCallback(
        async (chainId: string, nonceBase64: string): Promise<{ signature: string; pubKey: string } | null> => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const adena = getAdena() as any;
            if (!adena || !state.connected || !state.address) return null;
            if (typeof adena.SignMultisigTransaction !== "function") return null;
            try {
                const doc = buildLoginChallengeDoc(chainId, state.address, nonceBase64);
                const res = await adena.SignMultisigTransaction(doc);
                if (!res || res.status === "failure") return null;
                const signature = res.data?.signature?.signature;
                if (!signature) return null;
                // Adena returns the pubkey it signed with: { "@type":"/tm.PubKeySecp256k1", value }.
                const pubKeyValue = res.data?.signature?.pub_key?.value;
                const pubKey = pubKeyValue ? adenaPubKeyToJSON(pubKeyValue) : "";
                return { signature, pubKey };
            } catch (err) {
                console.error("[Memba] login challenge sign error:", err);
                return null;
            }
        },
        [state.connected, state.address]
    );

    /** Add a network to Adena wallet. Opens a confirmation popup.
     *  Params match Adena's AddNetworkParams: { chainId, chainName, rpcUrl }.
     *  Returns true on success (including "already added"), false on rejection/error. */
    const addNetwork = useCallback(
        async (params: { chainId: string; chainName: string; rpcUrl: string }): Promise<boolean> => {
            const adena = getAdena();
            if (!adena || typeof adena.AddNetwork !== "function") {
                console.warn("[Memba] Adena.AddNetwork not available");
                return false;
            }
            try {
                const res = await adena.AddNetwork(params);
                // Adena returns status:"success" or status:"failure"
                return res.status !== "failure";
            } catch (err) {
                console.error("[Memba] AddNetwork error:", err);
                return false;
            }
        },
        [],
    );

    /** Switch Adena wallet to a specific chain.
     *  Handles REDUNDANT_CHANGE_REQUEST (already on chain) as success.
     *  Handles UNADDED_NETWORK by calling addNetwork() first, then retrying.
     *  Returns true on success, false on failure. */
    const switchWalletNetwork = useCallback(
        async (chainId: string, chainName?: string, rpcUrl?: string): Promise<boolean> => {
            const adena = getAdena();
            if (!adena || typeof adena.SwitchNetwork !== "function") {
                console.warn("[Memba] Adena.SwitchNetwork not available");
                return false;
            }
            try {
                const res = await adena.SwitchNetwork(chainId);
                if (res.status !== "failure") return true;
                // UNADDED_NETWORK: try adding the network first, then switch again
                if (res.type === "UNADDED_NETWORK" && chainName && rpcUrl) {
                    const added = await addNetwork({ chainId, chainName, rpcUrl });
                    if (!added) return false;
                    const retry = await adena.SwitchNetwork(chainId);
                    return retry.status !== "failure";
                }
                return false;
            } catch (err) {
                console.error("[Memba] SwitchNetwork error:", err);
                return false;
            }
        },
        [addNetwork],
    );

    const disconnect = useCallback(() => {
        logWalletEvent("disconnect", "user");
        clearConnected();
        setWalletRpcContext(null, false);
        setState({
            connected: false,
            address: "",
            pubkeyJSON: "",
            chainId: "",
            loading: false,
            reconnecting: false,
            error: null,
            rpcUrl: "",
            rpcTrusted: false,
        });
    }, []);

    // SECURITY: Listen for network changes in Adena — re-validate RPC immediately.
    useEffect(() => {
        if (!state.connected) return;
        const adena = getAdena();
        if (!adena?.On || typeof adena.GetNetwork !== "function") return;

        const registered = adena.On("changedNetwork", async () => {
            logWalletEvent("changedNetwork");
            // Fail CLOSED for the whole re-validation window: from the instant
            // the wallet switches until the async reads below resolve, the old
            // trust/chain values are stale — a broadcast racing this handler
            // must be blocked, not waved through on pre-switch state.
            setWalletRpcContext(null, false, UNVERIFIED_CHAIN_ID);
            try {
                const netRes = await adena.GetNetwork();
                const url = netRes?.data?.rpcUrl || "";
                const trusted = url ? isTrustedRpcDomain(url) : false;

                // R2-CHN-E: the NEW chainId must reach grc20's wrong-chain guard.
                // Calling setWalletRpcContext with 2 args resets _walletChainId
                // to null, which silently DISABLES the guard right when it
                // matters most (the wallet just switched networks). GetNetwork
                // doesn't return a chainId, so re-fetch the account; if that
                // fails, fail CLOSED with the unverified sentinel — signing
                // stays blocked until the chain is verified again.
                let chainId: string = UNVERIFIED_CHAIN_ID;
                try {
                    const acct = await adena.GetAccount();
                    if (acct.status !== "failure" && acct.data) {
                        chainId = acct.data.chainId || UNVERIFIED_CHAIN_ID;
                        setState((s) => ({
                            ...s,
                            address: acct.data.address,
                            chainId: acct.data.chainId,
                        }));
                    }
                } catch { /* keep the fail-closed sentinel */ }

                setWalletRpcContext(url || null, trusted, chainId);
                setState((s) => ({ ...s, rpcUrl: url, rpcTrusted: trusted }));
            } catch {
                // GetNetwork failed after switch → strict: untrusted + unverified chain
                setWalletRpcContext(null, false, UNVERIFIED_CHAIN_ID);
                setState((s) => ({ ...s, rpcUrl: "", rpcTrusted: false }));
            }
        });

        // Cleanup: Adena.On returns boolean, no unsubscribe available
        void registered;
    }, [state.connected]);

    return {
        ...state,
        installed,
        connect,
        disconnect,
        signArbitrary,
        signLoginChallenge,
        addNetwork,
        switchWalletNetwork,
    };
}
