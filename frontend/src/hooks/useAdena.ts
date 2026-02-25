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
            console.error("[Memba] Adena not found on window");
            setState((s) => ({ ...s, error: "Adena wallet not installed" }));
            return false;
        }

        setState((s) => ({ ...s, loading: true, error: null }));

        try {
            // Request connection — Adena returns status:"failure" + type:"ALREADY_CONNECTED"
            // when the site was previously established. This is actually a success case.
            console.log("[Memba] Calling AddEstablish...");
            const connectRes = await adena.AddEstablish("Memba");
            console.log("[Memba] AddEstablish result:", connectRes);
            if (connectRes.status === "failure" && connectRes.type !== "ALREADY_CONNECTED") {
                console.error("[Memba] AddEstablish rejected:", connectRes);
                setState((s) => ({ ...s, loading: false, error: "Connection rejected" }));
                return false;
            }

            // Get account info
            console.log("[Memba] Calling GetAccount...");
            const accountRes: AdenaAccount = await adena.GetAccount();
            console.log("[Memba] GetAccount result:", accountRes);
            if (accountRes.status === "failure") {
                console.error("[Memba] GetAccount failed:", accountRes);
                setState((s) => ({ ...s, loading: false, error: "Failed to get account" }));
                return false;
            }

            const { address, publicKey, chainId } = accountRes.data;
            console.log("[Memba] Connected:", { address, chainId, pubkeyType: publicKey?.["@type"] });

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
            console.error("[Memba] Connect error:", err);
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
            if (!adena || !state.connected) {
                console.error("[Memba] signArbitrary: not connected or no adena");
                return null;
            }

            // Log available methods for diagnostics
            const methods = Object.keys(adena).filter(k => typeof adena[k] === "function");
            console.log("[Memba] Available adena methods:", methods);

            try {
                // adena.Sign() is the correct sign-only method (no broadcast).
                // Internally calls executor.signAmino. Confirmed from adena-wallet inject.ts.
                // DoContract signs AND broadcasts — wrong for auth challenges.
                if (typeof adena.Sign !== "function") {
                    console.error("[Memba] signArbitrary: adena.Sign not available");
                    return null;
                }

                console.log("[Memba] signArbitrary: calling adena.Sign...");
                const res = await adena.Sign({
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

                console.log("[Memba] signArbitrary: Sign result:", res);
                if (res.status === "failure") {
                    console.error("[Memba] signArbitrary: Sign failed:", res);
                    return null;
                }

                // Extract signature from response
                const sig = res.data?.signature?.signature
                    || res.data?.signed?.signature?.signature
                    || null;
                console.log("[Memba] signArbitrary: signature:", sig ? "OK" : "null");
                return sig;
            } catch (err) {
                console.error("[Memba] signArbitrary: EXCEPTION:", err);
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
