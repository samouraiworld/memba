/** Auth transport seam only: one fixed test account on onyx-1. Shell.lock, the window reducer and SignerProvider stay production code. */
import { useSyncExternalStore } from 'react'
import type { OsSession } from '../../src/os/shell/useOsSession'
import { activeOsNetwork } from '../../src/os/shell/network'
import { clearCommentDrafts } from '../../src/lib/notes/commentDraftStorage'
import { accounts, type AccountName } from './world'

const chosen = new URLSearchParams(location.search).get('account') as AccountName | null
export const TEST_ACCOUNT = accounts[chosen && chosen in accounts ? chosen : 'owner']
let member = true
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const setMember = (value: boolean) => { member = value; listeners.forEach(listener => listener()) }
export function useOsSession(opts: { onSignedIn?: (address: string) => void } = {}): OsSession {
    const connected = useSyncExternalStore(subscribe, () => member, () => member), network = activeOsNetwork(), address = connected ? TEST_ACCOUNT.address : ''
    const disconnect = () => { clearCommentDrafts(); setMember(false) }
    const connect = () => { setMember(true); opts.onSignedIn?.(TEST_ACCOUNT.address) }
    const noop = () => {}
    return {
        status: connected ? 'member' : 'guest', address, walletAddress: address, walletChainId: network.chainId, network,
        layout: { adena: { connected, address, pubkeyJSON: 'TEST', chainId: network.chainId, installed: true, loading: false, connect: async () => { connect(); return true }, disconnect, signArbitrary: async () => null },
            balance: '20 GNOT', rawUgnot: 20000000n, auth: { token: null, isAuthenticated: connected, address, loading: false, error: null }, isLoggingIn: false, syncTimedOut: false },
        stage: null, activationForced: false, activationCost: null, activationPriceEstimated: false, noFunds: false, balanceUnknown: false,
        balanceError: false, refreshBalance: noop, error: null, errorKind: null, slow: false, noPopup: false, note: null,
        openConnect: connect, wake: noop, chooseAdena: connect, recheck: noop, signIn: connect, activate: noop, cancel: noop, disconnect, switchWallet: noop,
    } as unknown as OsSession
}
