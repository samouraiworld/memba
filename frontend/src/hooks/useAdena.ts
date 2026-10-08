import { withWalletActivity } from "../lib/walletActivity";
import { ADENA_CLOSED_MESSAGE, ADENA_NO_ANSWER_MESSAGE, AdenaNoAnswerError, adenaPrompt, adenaRead, isAdenaWindowClosed, type PromptWatch } from "../lib/adenaCall";
import { LIVE_NETWORK_TIMEOUT_MS } from "../lib/walletNetworkGuard";
import { startWalletFlow, type WalletFlow } from "../lib/walletTiming";
import { useState, useCallback, useEffect, useSyncExternalStore } from "react";
import { isTrustedRpcDomain, networkScopedKey } from "../lib/config";
import { setWalletRpcContext, UNVERIFIED_CHAIN_ID } from "../lib/grc20";
import { buildAdenaMultisigDoc, type CanonicalSignDoc } from "../lib/multisigTx";
import { trackEvent } from "../lib/analytics";
import { buildLoginChallengeDoc, adenaPubKeyToJSON, loginRefusal, type LoginRefusal, type LoginSignature } from "../lib/loginChallenge";
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

interface AdenaPromptResult { status: string; type?: string }

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

/** The backend's JSON for the key Adena reports on its current network; "" while the account has never transacted there. */
function pubkeyJSONOf(publicKey: { value?: string } | null | undefined): string {
    return publicKey?.value ? adenaPubKeyToJSON(publicKey.value) : "";
}

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

/** Cache the GetNetwork URL for faster reconnect. Only the URL is stored —
 *  the TRUST verdict is re-derived from the allowlist on every read, so a
 *  stale or tampered cache entry can never replay `trusted: true` for a URL
 *  the allowlist would reject today. (Old entries that still carry a
 *  `trusted` field are read for their URL and re-judged the same way.) */
function getCachedRpc(): { url: string; trusted: boolean } | null {
    try {
        const raw = sessionStorage.getItem(SESSION_RPC_KEY);
        if (!raw) return null;
        const url = JSON.parse(raw)?.url;
        if (!url || typeof url !== "string") return null;
        return { url, trusted: isTrustedRpcDomain(url) };
    } catch { return null; }
}
function setCachedRpc(url: string) {
    try { sessionStorage.setItem(SESSION_RPC_KEY, JSON.stringify({ url })); } catch { /* no-op */ }
}

/** Reads Adena answers within this long during a connect the person started. */
const READ_TIMEOUT_MS = LIVE_NETWORK_TIMEOUT_MS
/** A silent reconnect's read limit. Adena's first GetAccount after a few idle minutes took ~4.2 s (measured). */
const SILENT_READ_TIMEOUT_MS = 8_000
const WAKE_TIMEOUT_MS = 4_000
/** A wake answer younger than this lets connect read instead of sending AddEstablish; until then no new wake is sent. */
const WAKE_FRESH_MS = 10_000

/** Why a connect the person started failed. */
export type ConnectFailure = "no-answer" | "closed" | "rejected" | "failed"

export interface ConnectOptions {
    /** Read only, never open Adena's window. */
    silent?: boolean
    /** Progress of Adena's window, and the reason when the connect fails. */
    watch?: PromptWatch & { onFailure?: (kind: ConnectFailure, message: string) => void }
    /** The person cancelled: checked after each wait and before AddEstablish. A cancelled connect opens no window and records no session. */
    signal?: AbortSignal
}

interface WalletReads {
    account: AdenaAccount | null | undefined
    network: { fresh: true; rpcUrl: string } | { fresh: false }
}

function accountOk(account: AdenaAccount | null | undefined): account is AdenaAccount {
    return !!account && account.status !== "failure" && !!account.data?.address
}

/**
 * GetAccount and GetNetwork side by side (Adena answers GetAccount with a chain
 * query, so the two in a row cost twice). GetAccount's no-answer rejects; a
 * failed or missing GetNetwork reads as not fresh (the caller falls back).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readWallet(adena: any, ms: number, flow?: WalletFlow | null): Promise<WalletReads> {
    const network: Promise<WalletReads["network"]> = typeof adena.GetNetwork === "function"
        ? adenaRead<{ data?: { rpcUrl?: string } } | null | undefined>(() => adena.GetNetwork(), ms)
            .then((res) => { flow?.step("network"); return { fresh: true as const, rpcUrl: res?.data?.rpcUrl || "" } })
            .catch(() => ({ fresh: false as const }))
        : Promise.resolve({ fresh: false as const })
    const account = adenaRead<AdenaAccount>(() => adena.GetAccount(), ms).then((res) => { flow?.step("account"); return res })
    const [a, n] = await Promise.all([account, network])
    return { account: a, network: n }
}

const initialState = (): AdenaState => ({
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

// One wallet per page. Every useAdena() reads and writes this store, so the silent
// reconnect, its Adena reads and Adena's event listeners run once, not once per
// component: each read costs Adena a wallet decrypt, and Adena's On() calls only
// the first listener registered for an event.
let walletState = initialState();
const storeListeners = new Set<() => void>();
function setState(next: AdenaState | ((s: AdenaState) => AdenaState)) {
    walletState = typeof next === "function" ? next(walletState) : next;
    for (const listener of storeListeners) listener();
}
function subscribeStore(listener: () => void) {
    storeListeners.add(listener);
    return () => { storeListeners.delete(listener); };
}
const getWalletState = () => walletState;

const autoReconnectAttempted = { current: false };
// F-24: bumped by disconnect(). An in-flight connect() compares it against
// the value it snapshotted before its awaits — a mismatch means the user
// disconnected mid-connect and the connect must stand down, whatever the
// storage state says.
const disconnectEpoch = { current: 0 };
// The last wake (a GetNetwork that warms Adena up while the person decides): when it
// started, when it answered, and whether Adena answered it as connected and unlocked.
const wakeState = { current: { startedAt: 0, answeredAt: 0, ok: false, running: null as Promise<boolean> | null } };
// The silent connect in flight, which an interactive one waits for instead of racing it.
const silentRun = { current: null as Promise<boolean> | null };
const lastVisibilityRetry = { current: 0 };

const accountChangedListeners = new Set<() => void>();
// The provider Adena's events are registered on: an extension update injects a new one.
let listenedProvider: unknown = null;
// Bumped by every re-read: only the latest one may write.
let rereadRun = 0;

/** Adena's own events, registered once per provider (Adena has no unsubscribe). */
function listenToAdena() {
    const adena = getAdena();
    if (!adena || adena === listenedProvider || typeof adena.On !== "function") return;
    listenedProvider = adena;
    // SECURITY: re-validate the RPC as soon as Adena changes network.
    adena.On("changedNetwork", () => {
        if (walletState.connected && typeof getAdena()?.GetNetwork === "function") void rereadWallet();
    });
    adena.On("changedAccount", () => { for (const listener of [...accountChangedListeners]) listener(); });
}

/** Hear Adena switching account. Returns the unsubscribe. */
export function onAdenaAccountChanged(listener: () => void): () => void {
    accountChangedListeners.add(listener);
    listenToAdena();
    return () => { accountChangedListeners.delete(listener); };
}

/** Read Adena's account and network again after it changed network: the address, chain, key and RPC it reports there. */
async function rereadWallet(): Promise<void> {
    const adena = getAdena();
    if (!adena || !walletState.connected) return;
    const epoch = disconnectEpoch.current;
    const run = ++rereadRun;
    logWalletEvent("changedNetwork");
    // Fail CLOSED for the whole re-validation window: from the instant
    // the wallet switches until the reads below resolve, the old
    // trust/chain values are stale — a broadcast racing this must be
    // blocked, not waved through on pre-switch state.
    setWalletRpcContext(null, false, UNVERIFIED_CHAIN_ID);
    // Side by side: Adena queues them anyway, and each costs it a wallet decrypt.
    const [net, acct] = await Promise.allSettled([
        adenaRead<{ data?: { rpcUrl?: string } } | null | undefined>(() => adena.GetNetwork(), READ_TIMEOUT_MS),
        adenaRead<AdenaAccount>(() => adena.GetAccount(), READ_TIMEOUT_MS),
    ]);
    // A disconnect, or a newer re-read, owns the wallet now: keep the fail-closed context and write nothing.
    if (epoch !== disconnectEpoch.current || run !== rereadRun || !walletState.connected) return;
    if (net.status === "rejected") {
        // GetNetwork failed after switch → strict: untrusted + unverified chain
        setWalletRpcContext(null, false, UNVERIFIED_CHAIN_ID);
        setState((s) => ({ ...s, rpcUrl: "", rpcTrusted: false }));
        return;
    }
    const url = net.value?.data?.rpcUrl || "";
    const trusted = url ? isTrustedRpcDomain(url) : false;
    // R2-CHN-E: the NEW chainId must reach grc20's wrong-chain guard (two
    // arguments would reset it to null and DISABLE the guard right after a
    // switch). The cached chain id and account come from the account read; if
    // it fails, fail CLOSED with the unverified sentinel — signing stays
    // blocked until the chain is verified again.
    let chainId: string = UNVERIFIED_CHAIN_ID;
    let address: string | null = null;
    const account = acct.status === "fulfilled" ? acct.value : null;
    const read = account && account.status !== "failure" && account.data ? account.data : null;
    if (read) {
        chainId = read.chainId || UNVERIFIED_CHAIN_ID;
        address = read.address || null;
    }
    setWalletRpcContext(url || null, trusted, chainId, address);
    // Adena's key is per network: unknown on a network the account never used, known only there.
    setState((s) => ({
        ...s,
        ...(read ? { address: read.address, chainId: read.chainId, pubkeyJSON: pubkeyJSONOf(read.publicKey) } : {}),
        rpcUrl: url,
        rpcTrusted: trusted,
    }));
}

/** Tests only: a fresh page's wallet store. */
export function __resetWalletStoreForTests(): void {
    walletState = initialState();
    autoReconnectAttempted.current = false;
    disconnectEpoch.current = 0;
    wakeState.current = { startedAt: 0, answeredAt: 0, ok: false, running: null };
    silentRun.current = null;
    lastVisibilityRetry.current = 0;
    accountChangedListeners.clear();
    listenedProvider = null;
    rereadRun = 0;
}

export function useAdena() {
    const [installed, setInstalled] = useState(() => !!getAdena());
    const state = useSyncExternalStore(subscribeStore, getWalletState);

    // Extensions inject globals after page load — poll to detect.
    // Adena can take up to 5-10s depending on browser load.
    useEffect(() => {
        if (installed) return;

        // Check immediately
        // eslint-disable-next-line react-hooks/set-state-in-effect -- the extension may have injected since the first render
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

    useEffect(() => { if (installed) listenToAdena() }, [installed])

    /**
     * Wake Adena before the person clicks: GetNetwork, a read that opens no window, for 4 s
     * at most, and not again while its last answer is fresh (10 s): the answer handed back is
     * never older than connect accepts. Adena answers it with success only for a site it has
     * approved while it is unlocked (otherwise NOT_CONNECTED or WALLET_LOCKED), so a fresh
     * success means connect can skip AddEstablish. Resolves whether it did.
     */
    const wake = useCallback((): Promise<boolean> => {
        const adena = getAdena()
        if (!adena || typeof adena.GetNetwork !== "function") return Promise.resolve(false)
        const w = wakeState.current
        if (w.running) return w.running
        if (w.answeredAt && Date.now() - w.answeredAt < WAKE_FRESH_MS) return Promise.resolve(w.ok)
        const startedAt = Date.now()
        const running = adenaRead<{ status?: string } | null | undefined>(() => adena.GetNetwork(), WAKE_TIMEOUT_MS)
            .then((reply) => !!reply && reply.status !== "failure", () => false)
            .then((ok) => {
                wakeState.current = { startedAt, answeredAt: Date.now(), ok, running: null }
                logWalletEvent("timing", `wake ${ok ? "connected" : "not-connected"} +${Date.now() - startedAt}ms`)
                return ok
            })
        wakeState.current = { ...w, startedAt, running }
        return running
    }, [])

    const connect = useCallback(async (opts?: ConnectOptions) => {
        const silent = !!opts?.silent
        const adena = getAdena()
        if (!adena) {
            setState((s) => ({ ...s, error: "Adena wallet not installed" }));
            return false;
        }
        if (silent && silentRun.current) return silentRun.current
        listenToAdena()

        const watch = opts?.watch
        const signal = opts?.signal
        const flow = silent ? null : startWalletFlow("connect")
        flow?.step("click")
        // An interactive connect while a silent one runs: wait for it, and go on only if it failed.
        if (!silent && silentRun.current) {
            if (await silentRun.current) { flow?.end("resumed"); return true }
        }
        if (signal?.aborted) { flow?.end("cancelled"); return false }

        const run = (async (): Promise<boolean> => {
            setState((s) => ({ ...s, loading: true, error: null }));

            // F-24: snapshot the disconnect state BEFORE any await. The epoch
            // catches this instance's own disconnect() — the button, or Layout's
            // programmatic one on changedAccount — landing anywhere in the awaits
            // below, including the human-paced AddEstablish window. The flag
            // snapshot catches another tab or another hook instance clearing the
            // session; the `hadFlag &&` in the guard keeps that clause inert when
            // storage is unavailable (privacy-hardened browsers) or on a
            // first-time connect, so neither can produce a spurious abort.
            const epoch = disconnectEpoch.current;
            const hadFlag = wasConnected();

            const fail = (kind: ConnectFailure, message: string) => {
                setState((s) => ({ ...s, loading: false, error: message }))
                watch?.onFailure?.(kind, message)
                flow?.end(kind)
                return false
            }
            // The person cancelled while this connect waited: stand down quietly.
            const cancelled = () => {
                setState((s) => ({ ...s, loading: false }))
                flow?.end("cancelled")
                return false
            }

            try {
                let reads: WalletReads | null = null
                if (silent) {
                    // Silent reconnect: read only — if the user already whitelisted Memba and
                    // Adena is unlocked, this succeeds without a window. Otherwise give up: the
                    // user can browse freely and connect when needed.
                    try {
                        reads = await readWallet(adena, SILENT_READ_TIMEOUT_MS)
                    } catch { /* no answer in time — wallet asleep or the tab predates an Adena update */ }
                    if (!reads || !accountOk(reads.account)) {
                        logWalletEvent("silent-check-failed", "wallet locked, not whitelisted or not answering")
                        setState((s) => ({ ...s, loading: false, reconnecting: false }))
                        return false
                    }
                } else {
                    // Adena answers the wake fast only when it is awake; one still running is waited for (4 s at most).
                    if (wakeState.current.running) { await wakeState.current.running; flow?.step("wake") }
                    if (signal?.aborted) return cancelled()
                    const w = wakeState.current
                    if (w.ok && Date.now() - w.answeredAt < WAKE_FRESH_MS) {
                        // Approved and unlocked a moment ago: read, and open no window. AddEstablish
                        // would close every Adena window, other tabs' included.
                        reads = await readWallet(adena, READ_TIMEOUT_MS, flow)
                        if (!accountOk(reads.account)) reads = null
                    }
                    if (!reads) {
                        if (signal?.aborted) return cancelled()
                        // Adena answers ALREADY_CONNECTED at once for an approved, unlocked wallet;
                        // otherwise its window asks to approve Memba or to unlock.
                        flow?.step("establish-sent")
                        const connectRes = await adenaPrompt<AdenaPromptResult>(() => adena.AddEstablish("Memba"), {
                            ...watch,
                            onPopupFocus: () => { flow?.step("popup-focus"); watch?.onPopupFocus?.() },
                        })
                        flow?.step("establish-done")
                        if (isAdenaWindowClosed(connectRes)) return fail("closed", ADENA_CLOSED_MESSAGE)
                        if (connectRes.status === "failure" && connectRes.type !== "ALREADY_CONNECTED") return fail("rejected", "Connection rejected")
                        reads = await readWallet(adena, READ_TIMEOUT_MS, flow)
                    }
                }

                const accountRes = reads.account
                // Validate account
                if (!accountOk(accountRes)) return fail("failed", "Failed to get account")

                const { address, publicKey, chainId } = accountRes.data;

                const pubkeyJSON = pubkeyJSONOf(publicKey);

                // SECURITY: the wallet's active RPC URL, from GetNetwork() (read alongside the account).
                let rpcUrl = "";
                let rpcTrusted = false;
                const gotFreshNetwork = reads.network.fresh; // cache write deferred past the guard
                if (reads.network.fresh) {
                    rpcUrl = reads.network.rpcUrl
                    rpcTrusted = rpcUrl ? isTrustedRpcDomain(rpcUrl) : false
                } else {
                    // GetNetwork unavailable or failed → try cached value from previous session, else strict: untrusted
                    const cached = getCachedRpc();
                    if (cached) { rpcUrl = cached.url; rpcTrusted = cached.trusted; }
                }

                // F-24: a disconnect may have landed while the awaits above were in
                // flight — this instance's disconnect() (epoch mismatch) or another
                // tab/instance clearing the session flag. Completing would silently
                // undo the user's disconnect, so stand down BEFORE anything is
                // persisted or published (same storage-is-truth rule as the
                // changedNetwork publish guard). Everything with a side effect —
                // session flag, analytics, RPC cache, wallet RPC context, state —
                // sits below this line.
                if (disconnectEpoch.current !== epoch || (hadFlag && !wasConnected())) {
                    logWalletEvent("connect-aborted", "disconnected during connect");
                    setState((s) => ({ ...s, loading: false, reconnecting: false }));
                    flow?.end("aborted")
                    return false;
                }
                // Cancelled while Adena's window or the reads were open: nothing is recorded either.
                if (signal?.aborted) return cancelled()

                // Only an INTERACTIVE connect asserts the session flag — it is
                // fresh user intent. A silent reconnect merely acts on a flag that
                // was already true when it started.
                if (!silent) saveConnected();
                trackEvent("Wallet Connected");
                logWalletEvent("connected", silent ? "silent" : "interactive");
                if (gotFreshNetwork) setCachedRpc(rpcUrl);

                setWalletRpcContext(rpcUrl || null, rpcTrusted, chainId || null, address || null);

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
                flow?.end("connected")
                return true;
            } catch (err) {
                logWalletEvent("connect-error", err instanceof Error ? err.message : "unknown");
                console.error("[Memba] Connect error:", err);
                if (err instanceof AdenaNoAnswerError) return fail("no-answer", ADENA_NO_ANSWER_MESSAGE)
                return fail("failed", err instanceof Error ? err.message : "Connection failed")
            }
        })()
        if (silent) {
            silentRun.current = run
            void run.finally(() => { if (silentRun.current === run) silentRun.current = null })
        }
        return run
    }, []);

    // Auto-reconnect: if sessionStorage flag exists and Adena is installed,
    // attempt silent reconnect (no popup). If wallet is locked or not
    // whitelisted, silently give up — user can connect manually when needed.
    useEffect(() => {
        if (!installed || autoReconnectAttempted.current) return;
        if (!wasConnected()) {
            // No earlier session: nothing to resume.
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
    useEffect(() => {
        if (!installed) return;
        const onVisible = () => {
            if (document.hidden) return;
            if (walletState.connected || walletState.loading) return;
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
                    const res = await withWalletActivity(async () => adena.SignMultisigTransaction(multisigDoc));
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
     *  wallets (no on-chain pubkey) authenticate by proving key ownership. Says
     *  why when there is no signature. */
    const signLoginChallenge = useCallback(
        async (chainId: string, nonceBase64: string, watch?: PromptWatch): Promise<LoginSignature | LoginRefusal> => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const adena = getAdena() as any;
            if (!adena || !state.connected || !state.address) return "failed";
            if (typeof adena.SignMultisigTransaction !== "function") return "unsupported";
            try {
                const doc = buildLoginChallengeDoc(chainId, state.address, nonceBase64);
                const res = await adenaPrompt(async () => adena.SignMultisigTransaction(doc), watch);
                if (!res) return "failed";
                if (res.status === "failure") return loginRefusal(res);
                const signature = res.data?.signature?.signature;
                if (!signature) return "failed";
                // Adena returns the pubkey it signed with: { "@type":"/tm.PubKeySecp256k1", value }.
                const pubKeyValue = res.data?.signature?.pub_key?.value;
                const pubKey = pubKeyValue ? adenaPubKeyToJSON(pubKeyValue) : "";
                return { signature, pubKey };
            } catch (err) {
                console.error("[Memba] login challenge sign error:", err);
                return err instanceof AdenaNoAnswerError ? "no-answer" : "failed";
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
                const res = await withWalletActivity<AdenaPromptResult>(() => adena.AddNetwork(params));
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
                const res = await withWalletActivity<AdenaPromptResult>(() => adena.SwitchNetwork(chainId));
                // Switched, or already there: read the wallet now rather than wait for Adena's
                // changedNetwork event, so the chain, key and RPC shown are the new ones.
                if (res.status !== "failure" || res.type === "REDUNDANT_CHANGE_REQUEST") { await rereadWallet(); return true; }
                // UNADDED_NETWORK: try adding the network first, then switch again
                if (res.type === "UNADDED_NETWORK" && chainName && rpcUrl) {
                    const added = await addNetwork({ chainId, chainName, rpcUrl });
                    if (!added) return false;
                    const retry = await withWalletActivity<AdenaPromptResult>(() => adena.SwitchNetwork(chainId));
                    if (retry.status === "failure") return false;
                    await rereadWallet();
                    return true;
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
        // F-24: invalidate any connect() currently sitting in its awaits —
        // storage alone can't signal this (saveConnected may not have run yet,
        // and storage can be unavailable entirely).
        disconnectEpoch.current++;
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

    return {
        ...state,
        installed,
        connect,
        wake,
        disconnect,
        signArbitrary,
        signLoginChallenge,
        addNetwork,
        switchWalletNetwork,
    };
}
