import { useState, useCallback, useEffect, useRef } from "react";
import { isTrustedRpcDomain } from "../lib/config";
import { setWalletRpcContext } from "../lib/grc20";
import { trackEvent } from "../lib/analytics";

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

// Session persistence key — cleared when browser is closed (not tab).
const SESSION_KEY = "memba_adena_connected";
const SESSION_RPC_KEY = "memba_adena_rpc";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getAdena(): any {
    return (window as unknown as Record<string, unknown>).adena;
}

function wasConnected(): boolean {
    try { return sessionStorage.getItem(SESSION_KEY) === "true"; } catch { return false; }
}
function saveConnected() {
    try { sessionStorage.setItem(SESSION_KEY, "true"); } catch { /* no-op */ }
}
function clearConnected() {
    try { sessionStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_RPC_KEY); } catch { /* no-op */ }
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

    const connect = useCallback(async () => {
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
            } catch { /* silent check failed, fall through to AddEstablish */ }

            if (!accountRes) {
                // Full establish flow — shows Adena approval popup
                const connectRes = await adena.AddEstablish("Memba");
                if (connectRes.status === "failure" && connectRes.type !== "ALREADY_CONNECTED") {
                    setState((s) => ({ ...s, loading: false, error: "Connection rejected" }));
                    return false;
                }
                accountRes = await adena.GetAccount();
            }

            // Validate account
            if (accountResFinal.status === "failure") {
                setState((s) => ({ ...s, loading: false, error: "Failed to get account" }));
                return false;
            }

            const { address, publicKey, chainId } = accountResFinal.data;

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
            setWalletRpcContext(rpcUrl || null, rpcTrusted);

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
            console.error("[Memba] Connect error:", err);
            setState((s) => ({
                ...s,
                loading: false,
                error: err instanceof Error ? err.message : "Connection failed",
            }));
            return false;
        }
    }, []);

    // Auto-reconnect: if sessionStorage flag exists and Adena is installed, reconnect.
    useEffect(() => {
        if (!installed || autoReconnectAttempted.current) return;
        if (!wasConnected()) {
            setState((s) => ({ ...s, reconnecting: false }));
            return;
        }
        autoReconnectAttempted.current = true;
        connect().finally(() => {
            setState((s) => ({ ...s, reconnecting: false }));
        });
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
                const parsed = JSON.parse(data);

                // Convert Amino fee to Adena's multisig fee format:
                // Amino: {amount: [{denom: "ugnot", amount: "10000"}], gas: "100000"}
                // Adena: {gas_fee: "10000ugnot", gas_wanted: "100000"}
                const aminoFee = parsed.fee;
                const adenaFee = {
                    gas_wanted: aminoFee.gas || "100000",
                    gas_fee: aminoFee.amount?.[0]
                        ? `${aminoFee.amount[0].amount}${aminoFee.amount[0].denom}`
                        : "10000ugnot",
                };
                // Convert Amino msgs to Adena-native format (from official docs):
                // Amino:  {type: "bank/MsgSend", value: {from_address, to_address, amount: [{denom, amount}]}}
                // Adena:  {"@type": "/bank.MsgSend", from_address, to_address, amount: "9997ugnot"}
                // The executor normalizes @type msgs to {type, value} internally (executor.ts:228-233)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const adenaMessages = parsed.msgs.map((m: any) => {
                    const adenaType = m.type.startsWith("/") ? m.type : `/${m.type.replace("/", ".")}`;
                    const value = m.value || {};

                    // Convert Cosmos SDK amount array to Gno string format
                    let amount = value.amount;
                    if (Array.isArray(amount) && amount.length > 0) {
                        amount = `${amount[0].amount}${amount[0].denom}`;
                    }

                    return {
                        "@type": adenaType,
                        ...value,
                        amount,
                    };
                });

                // Build Adena's MultisigTransactionDocument format
                const multisigDoc = {
                    tx: {
                        msg: adenaMessages,
                        fee: adenaFee,
                        signatures: null,
                        memo: parsed.memo || "",
                    },
                    chainId: parsed.chain_id,
                    accountNumber: parsed.account_number,
                    sequence: parsed.sequence,
                };

                // Try SignMultisigTransaction first (correct for multisig)
                if (typeof adena.SignMultisigTransaction === "function") {
                    const res = await adena.SignMultisigTransaction(multisigDoc);
                    if (res.status !== "failure") {
                        const sig = res.data?.signature?.signature;
                        if (sig) return sig;
                    }
                }

                // Fallback: try Sign() (uses signer's own account — may not work for multisig)
                if (typeof adena.Sign === "function") {
                    const res = await adena.Sign({
                        messages: adenaMessages,
                        memo: parsed.memo || "",
                    });
                    if (res.status !== "failure") {
                        return res.data?.signature?.signature
                            || res.data?.signed?.signature?.signature
                            || null;
                    }
                }

                return null;
            } catch (err) {
                console.error("[Memba] Sign error:", err);
                return null;
            }
        },
        [state.connected]
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
            try {
                const netRes = await adena.GetNetwork();
                const url = netRes?.data?.rpcUrl || "";
                const trusted = url ? isTrustedRpcDomain(url) : false;
                setWalletRpcContext(url || null, trusted);
                setState((s) => ({ ...s, rpcUrl: url, rpcTrusted: trusted }));

                // Also re-fetch account (address/chainId may change)
                try {
                    const acct = await adena.GetAccount();
                    if (acct.status !== "failure" && acct.data) {
                        setState((s) => ({
                            ...s,
                            address: acct.data.address,
                            chainId: acct.data.chainId,
                        }));
                    }
                } catch { /* silent */ }
            } catch {
                // GetNetwork failed after switch → strict: untrusted
                setWalletRpcContext(null, false);
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
        addNetwork,
        switchWalletNetwork,
    };
}
