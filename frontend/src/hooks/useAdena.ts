import { useState, useCallback, useEffect } from "react";

// Adena injects `window.adena` when the extension is installed.
// Docs: https://docs.adena.app/integrations/adena-api

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
            // Request connection
            const connectRes = await adena.AddEstablish("Memba");
            if (connectRes.status === "failure") {
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

            // Build Amino JSON pubkey for auth
            const pubkeyJSON = JSON.stringify({
                type: "tendermint/PubKeySecp256k1",
                value: publicKey.value,
            });

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
            setState((s) => ({
                ...s,
                loading: false,
                error: err instanceof Error ? err.message : "Connection failed",
            }));
            return false;
        }
    }, []);

    const signArbitrary = useCallback(
        async (data: string): Promise<string | null> => {
            const adena = getAdena();
            if (!adena || !state.connected) return null;

            try {
                const res = await adena.SignAmino({
                    messages: [
                        {
                            type: "sign/MsgSignData",
                            value: {
                                signer: state.address,
                                data: btoa(data),
                            },
                        },
                    ],
                    fee: { amount: [], gas: "0" },
                    memo: "",
                });

                if (res.status === "failure") return null;
                // Extract signature from response
                return res.data?.signature?.signature || null;
            } catch {
                return null;
            }
        },
        [state.connected, state.address]
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
