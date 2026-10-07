/**
 * The network Memba OS runs on. /os URLs carry no network prefix, so the
 * active network is the one the config was loaded with (explicit preference,
 * else the default: mainnet). Switching saves the same preference as
 * useNetwork().switchNetwork, then reloads the same /os URL: that hook
 * redirects to /<network>/…, which would leave Memba OS.
 *
 * With VITE_ENABLE_EVM, the preference may also name a visible EVM network
 * (lib/chain/evm/networks.ts). Gno config ignores such a key and loads on its
 * default, so only Memba OS runs on Base; with the flag off the key is ignored.
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
import { EVM_NETWORKS, isVisibleEvmNetworkKey, storedEvmNetworkKey } from "../../lib/chain/evm/networks"
import { EVM_ENABLED } from "../../lib/chain/flag"
import type { ChainFamily } from "../../lib/chain/types"
import { OS_NET_SWITCHED_KEY } from "../../lib/networkSwitch"
import { completeQuest, getQuestWalletAddress } from "../../lib/quests"
import { trackNetworkVisit } from "../../lib/questVerifier"

export interface OsNetwork {
    key: string
    family: ChainFamily
    /** The id the wallet knows the chain by: "gnoland-1", or the EIP-155 id as a decimal string. */
    chainId: string
    label: string
    isTestnet: boolean
    rpcHost: string
}

function hostOf(url: string): string {
    try {
        return new URL(url).host
    } catch {
        return url
    }
}

function describe(key: string): OsNetwork {
    if (EVM_ENABLED && isVisibleEvmNetworkKey(key)) {
        const e = EVM_NETWORKS[key]
        return { key, family: "evm", chainId: String(e.chainId), label: e.label, isTestnet: e.isTestnet, rpcHost: hostOf(e.rpcUrl) }
    }
    const n = NETWORKS[key]
    return { key, family: "gno", chainId: n.chainId, label: n.label, isTestnet: !!n.isTestnet, rpcHost: hostOf(n.rpcUrl) }
}

/** The network this page's Memba OS was loaded on. A switch reloads, so it never changes in a page's life. */
const OS_NETWORK_KEY: string = (EVM_ENABLED ? storedEvmNetworkKey() : null) ?? ACTIVE_NETWORK_KEY

function isOsNetworkKey(key: string): boolean {
    return isNetworkKey(key) || (EVM_ENABLED && isVisibleEvmNetworkKey(key))
}

/** How the menu bar names a network: its chain id on gno.land, its name on EVM (a bare number says nothing). */
export function networkName(n: OsNetwork): string {
    return n.family === "evm" ? n.label : n.chainId
}

export function activeOsNetwork(): OsNetwork {
    return describe(OS_NETWORK_KEY)
}

/** The gno.land network this page's config was loaded with: where "Switch to gno.land" goes from an EVM network. */
export function gnoOsNetwork(): OsNetwork {
    return describe(ACTIVE_NETWORK_KEY)
}

/** What the network menu offers: the visible networks, plus the active one if it's hidden. */
export function selectableOsNetworks(): OsNetwork[] {
    const gno = Object.keys(selectableNetworksFor(ACTIVE_NETWORK_KEY))
    const evm = EVM_ENABLED ? Object.keys(EVM_NETWORKS).filter(isVisibleEvmNetworkKey) : []
    return [...gno, ...evm].map(describe)
}

/** Shown once after the reload that a switch triggers. Single source of truth
 *  is `lib/networkSwitch.ts` — `hooks/useNetwork.ts` (which cannot import from
 *  `src/os/`) sets the same key on its own /os reload path. Re-exported here
 *  so existing importers of this module keep working. */
export { OS_NET_SWITCHED_KEY }

export function switchOsNetwork(key: string): void {
    if (!isOsNetworkKey(key) || key === OS_NETWORK_KEY) return
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
    // The network quests are gno.land's: a switch to an EVM network earns none.
    if (isNetworkKey(key)) {
        try {
            completeQuest("switch-network")
            const questAddr = getQuestWalletAddress()
            if (questAddr) trackNetworkVisit(questAddr, key)
        } catch { /* quest tracking cannot prevent an already-persisted switch */ }
    }
    // Module-load config (RPC, registry paths) is computed once: reload to apply it.
    window.location.reload()
}

/** The toast text for a switch that just happened, once. */
export function takeNetworkSwitchNotice(): string | null {
    try {
        const key = sessionStorage.getItem(OS_NET_SWITCHED_KEY)
        if (!key) return null
        sessionStorage.removeItem(OS_NET_SWITCHED_KEY)
        if (key !== OS_NETWORK_KEY) return null
        const n = describe(key)
        const name = networkName(n)
        return n.isTestnet
            ? `Switched to ${name} · testnet: sandbox funds, nothing here is real`
            : `Switched to ${name} · mainnet: real funds`
    } catch {
        return null
    }
}
