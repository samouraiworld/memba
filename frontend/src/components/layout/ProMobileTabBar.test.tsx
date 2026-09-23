import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
// Pin the module-load ACTIVE network to pearl — the chain Memba's realms are
// actually deployed on. `config.ts` resolves it from the URL/localStorage
// BEFORE any import runs, so this must be hoisted above the imports; a jsdom
// test has no URL network segment, which left it falling through to
// DEFAULT_NETWORK. That was invisible while the default was a realm-backed
// testnet, and became load-bearing at the 2026-09-17 mainnet flip: on a
// realm-free default this file's subject changes behaviour for reasons that
// have nothing to do with what it asserts.
// Mainnet cutover (2026-09-23): pearl is RETIRED (hidden), and a hidden
// network is never restored from storage — only honoured when it is IN THE
// URL. So the pin moved from localStorage to the jsdom URL: pearl keeps its
// full realm allowlist, which is what this file needs.
vi.hoisted(() => {
    window.history.replaceState(null, "", "/pearl/")
})

vi.mock('../../hooks/useNetworkNav', () => ({ useNetworkKey: () => 'pearl' }))
vi.mock('../../lib/config', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/config')>(), PRO_SHELL_ENABLED: true }))
vi.mock('./ActFab', () => ({ ActFab: () => null }))
import { MobileTabBar } from './MobileTabBar'
const network = { networkKey: 'pearl', networks: {}, switchNetwork: vi.fn() }
const auth = { token: null, isAuthenticated: false, address: '', loading: false, error: null }
function mount(connected = false) {
    render(<MemoryRouter initialEntries={['/pearl/settings']}><MobileTabBar connected={connected} address={connected ? 'g1member' : null} auth={auth as never} network={network} feedReplyUnread={3} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /More/ }))
    return within(screen.getByRole('dialog', { name: 'More options' }))
}
describe('professional mobile navigation', () => {
    it('preserves member destinations and addressed profiles while using four primary links', () => {
        const menu = mount(true)
        expect(within(screen.getByRole('navigation', { name: 'Mobile navigation' })).getAllByRole('link')).toHaveLength(4)
        for (const label of ['Organizations', 'Candidature', 'Multisig', 'Leaderboard']) expect(menu.getByRole('link', { name: label })).toBeInTheDocument()
        expect(menu.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/pearl/profile/g1member')
        expect(menu.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
        expect(menu.getByLabelText('3 new replies')).toBeInTheDocument()
        expect(menu.queryByRole('link', { name: 'Quest Admin' })).not.toBeInTheDocument()
        fireEvent.click(menu.getByRole('button', { name: 'Close menu' }))
        expect(screen.getByRole('dialog', { name: 'More options' })).toHaveAttribute('aria-modal', 'false')
    })
    it('keeps wallet-only links out of the visitor menu', () => {
        const menu = mount()
        for (const label of ['Organizations', 'Candidature', 'Multisig', 'Profile']) expect(menu.queryByRole('link', { name: label })).not.toBeInTheDocument()
        expect(menu.getByRole('link', { name: /^Feed(,| |$)/ })).toHaveAttribute('href', '/pearl/feed')
    })
})
