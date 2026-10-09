/** Auth transport seam only. Shell.lock, window reducer and SignerProvider remain production code. */
import { useSyncExternalStore } from 'react'
import type { OsSession } from '../../src/os/shell/useOsSession'
import { activeOsNetwork } from '../../src/os/shell/network'
import { bech32Encode } from '../../src/lib/dao/realmAddress'
import { audit } from './audit'
export const TEST_OWNER = bech32Encode('g', new Uint8Array(20).fill(81))
let member = true
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const setMember = (value: boolean) => { member = value; listeners.forEach(listener => listener()) }
export function useOsSession(opts: { onSignedIn?: (address: string) => void } = {}): OsSession {
    const connected = useSyncExternalStore(subscribe, () => member, () => member), network = activeOsNetwork()
    const disconnect = () => { audit.disconnects++; setMember(false) }
    const connect = () => { setMember(true); opts.onSignedIn?.(TEST_OWNER) }
    const noop = () => {}
    return {
        status: connected ? 'member' : 'guest', address: connected ? TEST_OWNER : '', walletAddress: connected ? TEST_OWNER : '', walletChainId: network.chainId, network,
        layout: { adena: { connected, address: connected ? TEST_OWNER : '', pubkeyJSON: 'TEST', chainId: network.chainId, installed: true, loading: false, connect: async () => { connect(); return true }, disconnect, signArbitrary: async () => null },
            balance: '100 GNOT', rawUgnot: 100000000n, auth: { token: null, isAuthenticated: connected, address: connected ? TEST_OWNER : '', loading: false, error: null }, isLoggingIn: false, syncTimedOut: false },
        stage: null, activationForced: false, activationCost: null, activationPriceEstimated: false, noFunds: false, balanceUnknown: false,
        balanceError: false, refreshBalance: noop, error: null, errorKind: null, slow: false, noPopup: false, note: null,
        openConnect: connect, wake: noop, chooseAdena: connect, recheck: noop, signIn: connect, activate: noop, cancel: noop, disconnect, switchWallet: noop,
    } as unknown as OsSession
}
