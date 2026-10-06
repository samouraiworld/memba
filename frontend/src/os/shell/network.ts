/**
 * The network Memba OS runs on. /os URLs carry no network prefix, so the
 * active network is the one the config was loaded with (explicit preference,
 * else the default: mainnet). Switching saves the same preference as
 * useNetwork().switchNetwork, then reloads the same /os URL: that hook
 * redirects to /<network>/…, which would leave Memba OS.
 *
 * @module os/shell/network
 */
import {
    ACTIVE_NETWORK_KEY,
    NETWORK_ECHO_STORAGE_KEY,
    NETWORK_PREF_STORAGE_KEY,
    NETWORKS,
    isNetworkKey,
    selectableNetworksFor,
} from "../../lib/config"
import { OS_NET_SWITCHED_KEY } from "../../lib/networkSwitch"
import { completeQuest, getQuestWalletAddress } from "../../lib/quests"
import { trackNetworkVisit } from "../../lib/questVerifier"

export interface OsNetwork {
    key: string
    chainId: string
    label: string
    isTestnet: boolean
    rpcHost: string
}

function describe(key: string): OsNetwork {
    const n = NETWORKS[key]
    let rpcHost = ""
    try {
        rpcHost = new URL(n.rpcUrl).host
    } catch {
        rpcHost = n.rpcUrl
    }
    return { key, chainId: n.chainId, label: n.label, isTestnet: !!n.isTestnet, rpcHost }
}

export function activeOsNetwork(): OsNetwork {
    return describe(ACTIVE_NETWORK_KEY)
}

/** What the network menu offers: the visible networks, plus the active one if it's hidden. */
export function selectableOsNetworks(): OsNetwork[] {
    return Object.keys(selectableNetworksFor(ACTIVE_NETWORK_KEY)).map(describe)
}

/** Shown once after the reload that a switch triggers. Single source of truth
 *  is `lib/networkSwitch.ts` — `hooks/useNetwork.ts` (which cannot import from
 *  `src/os/`) sets the same key on its own /os reload path. Re-exported here
 *  so existing importers of this module keep working. */
export { OS_NET_SWITCHED_KEY }

export function switchOsNetwork(key: string): void {
    if (!isNetworkKey(key) || key === ACTIVE_NETWORK_KEY) return
    let oldPreference: string | null | undefined
    let oldEcho: string | null | undefined
    try {
        oldPreference = localStorage.getItem(NETWORK_PREF_STORAGE_KEY)
        oldEcho = localStorage.getItem(NETWORK_ECHO_STORAGE_KEY)
        localStorage.setItem(NETWORK_PREF_STORAGE_KEY, key)
        localStorage.setItem(NETWORK_ECHO_STORAGE_KEY, key)
    } catch {
        // A failed second write must not leave the first write changing the
        // selected chain on the next visit without this page having reloaded.
        if (oldPreference !== undefined) {
            try {
                if (oldPreference === null) localStorage.removeItem(NETWORK_PREF_STORAGE_KEY)
                else localStorage.setItem(NETWORK_PREF_STORAGE_KEY, oldPreference)
                if (oldEcho === null) localStorage.removeItem(NETWORK_ECHO_STORAGE_KEY)
                else if (oldEcho !== undefined) localStorage.setItem(NETWORK_ECHO_STORAGE_KEY, oldEcho)
            } catch { /* storage may remain unavailable */ }
        }
        return // without storage the reload would land on the same network
    }
    // The notice is optional; private browsers can deny sessionStorage while
    // allowing the local preference needed for the switch itself.
    try { sessionStorage.setItem(OS_NET_SWITCHED_KEY, key) } catch { /* no toast after reload */ }
    try {
        completeQuest("switch-network")
        const questAddr = getQuestWalletAddress()
        if (questAddr) trackNetworkVisit(questAddr, key)
    } catch { /* quest tracking cannot prevent an already-persisted switch */ }
    // Module-load config (RPC, registry paths) is computed once: reload to apply it.
    window.location.reload()
}

/** The toast text for a switch that just happened, once. */
export function takeNetworkSwitchNotice(): string | null {
    try {
        const key = sessionStorage.getItem(OS_NET_SWITCHED_KEY)
        if (!key) return null
        sessionStorage.removeItem(OS_NET_SWITCHED_KEY)
        if (key !== ACTIVE_NETWORK_KEY) return null
        return NETWORKS[key]?.isTestnet
            ? `Switched to ${NETWORKS[key].chainId} · testnet: sandbox funds, nothing here is real`
            : `Switched to ${NETWORKS[key]?.chainId ?? key} · mainnet: real funds`
    } catch {
        return null
    }
}
