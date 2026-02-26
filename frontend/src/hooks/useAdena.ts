import { useState, useCallback, useEffect } from "react";

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
    error: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getAdena(): any {
    return (window as unknown as Record<string, unknown>).adena;
}

export function useAdena() {
    const [installed, setInstalled] = useState(() => !!getAdena());
    const [state, setState] = useState<AdenaState>({
        connected: false,
        address: "",
        pubkeyJSON: "",
        chainId: "",
        loading: false,
        error: null,
    });

    // Extensions inject globals after page load — poll to detect.
    // Adena can take up to 5-10s depending on browser load.
    useEffect(() => {
        if (installed) return;

        // Check immediately
        if (getAdena()) { setInstalled(true); return; }

        let stopped = false;
        let attempts = 0;

        // Poll every 200ms for up to 10s
        const timer = setInterval(() => {
            if (getAdena()) { setInstalled(true); stopped = true; clearInterval(timer); }
            if (++attempts >= 50) clearInterval(timer);
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
            // Request connection — Adena returns status:"failure" + type:"ALREADY_CONNECTED"
            // when the site was previously established. This is actually a success case.
            const connectRes = await adena.AddEstablish("Memba");
            if (connectRes.status === "failure" && connectRes.type !== "ALREADY_CONNECTED") {
                setState((s) => ({ ...s, loading: false, error: "Connection rejected" }));
                return false;
            }

            // Get account info
            const accountRes: AdenaAccount = await adena.GetAccount();
            if (accountRes.status === "failure") {
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

            setState({
                connected: true,
                address,
                pubkeyJSON,
                chainId,
                loading: false,
                error: null,
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
                // Convert Amino msg types to Adena protobuf-style:
                // "bank/MsgSend" → "/bank.MsgSend", "vm/m_call" → "/vm.m_call"
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const adenaMessages = parsed.msgs.map((m: any) => ({
                    type: m.type.startsWith("/") ? m.type : `/${m.type.replace("/", ".")}`,
                    value: m.value,
                }));

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
                    console.warn("[Memba] Trying SignMultisigTransaction:", JSON.stringify(multisigDoc));
                    const res = await adena.SignMultisigTransaction(multisigDoc);
                    console.warn("[Memba] SignMultisigTransaction result:", JSON.stringify(res));
                    if (res.status !== "failure") {
                        const sig = res.data?.signature?.signature;
                        if (sig) return sig;
                    }
                } else {
                    console.warn("[Memba] SignMultisigTransaction not available");
                }

                // Fallback: try Sign() (uses signer's own account — may not work for multisig)
                if (typeof adena.Sign === "function") {
                    console.warn("[Memba] Trying Sign() fallback with messages:", JSON.stringify(adenaMessages));
                    const res = await adena.Sign({
                        messages: adenaMessages,
                        memo: parsed.memo || "",
                    });
                    console.warn("[Memba] Sign result:", JSON.stringify(res));
                    if (res.status !== "failure") {
                        return res.data?.signature?.signature
                            || res.data?.signed?.signature?.signature
                            || null;
                    }
                }

                console.warn("[Memba] All sign methods failed");
                return null;
            } catch (err) {
                console.error("[Memba] Sign error:", err);
                return null;
            }
        },
        [state.connected]
    );

    const disconnect = useCallback(() => {
        setState({
            connected: false,
            address: "",
            pubkeyJSON: "",
            chainId: "",
            loading: false,
            error: null,
        });
    }, []);

    return {
        ...state,
        installed,
        connect,
        disconnect,
        signArbitrary,
    };
}
