import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
vi.mock('../../hooks/useNetworkNav', () => ({ useNetworkKey: () => 'mainnet' }))
vi.mock('../../lib/config', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/config')>(), PRO_SHELL_ENABLED: true }))
vi.mock('./ActFab', () => ({ ActFab: () => null }))
import { MobileTabBar } from './MobileTabBar'
const network = { networkKey: 'mainnet', networks: {}, switchNetwork: vi.fn() }
const auth = { token: null, isAuthenticated: false, address: '', loading: false, error: null }
function mount(connected = false) {
    render(<MemoryRouter initialEntries={['/mainnet/settings']}><MobileTabBar connected={connected} address={connected ? 'g1member' : null} auth={auth as never} network={network} feedReplyUnread={3} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /More/ }))
    return within(screen.getByRole('dialog', { name: 'More options' }))
}
describe('professional mobile navigation', () => {
    it('preserves member destinations and addressed profiles while using four primary links', () => {
        const menu = mount(true)
        expect(within(screen.getByRole('navigation', { name: 'Mobile navigation' })).getAllByRole('link')).toHaveLength(4)
        for (const label of ['Organizations', 'Candidature', 'Multisig', 'Leaderboard']) expect(menu.getByRole('link', { name: label })).toBeInTheDocument()
        expect(menu.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/mainnet/profile/g1member')
        expect(menu.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
        expect(menu.getByLabelText('3 new replies')).toBeInTheDocument()
        expect(menu.queryByRole('link', { name: 'Quest Admin' })).not.toBeInTheDocument()
        fireEvent.click(menu.getByRole('button', { name: 'Close menu' }))
        expect(screen.getByRole('dialog', { name: 'More options' })).toHaveAttribute('aria-modal', 'false')
    })
    it('keeps wallet-only links out of the visitor menu', () => {
        const menu = mount()
        for (const label of ['Organizations', 'Candidature', 'Multisig', 'Profile']) expect(menu.queryByRole('link', { name: label })).not.toBeInTheDocument()
        expect(menu.getByRole('link', { name: /^Feed(,| |$)/ })).toHaveAttribute('href', '/mainnet/feed')
    })
})
