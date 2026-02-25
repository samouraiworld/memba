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

    /** Sign an Amino sign doc string via Adena's Sign() method.
     *  Used by TransactionView for MsgSend/MsgCall signing.
     *  Note: sign/MsgSignData (ADR-036) is NOT supported by Adena —
     *  only Gno-native types (/bank.MsgSend, /vm.m_call, etc.) work. */
    const signArbitrary = useCallback(
        async (data: string): Promise<string | null> => {
            const adena = getAdena();
            if (!adena || !state.connected) return null;

            try {
                const parsed = JSON.parse(data);
                const res = await adena.Sign({
                    messages: parsed.msgs,
                    fee: parsed.fee,
                    memo: parsed.memo || "",
                });

                if (res.status === "failure") return null;

                return res.data?.signature?.signature
                    || res.data?.signed?.signature?.signature
                    || null;
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
