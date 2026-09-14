import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
vi.mock('../../hooks/useNetworkNav', () => ({ useNetworkKey: () => 'mainnet' }))
vi.mock('../../lib/quests', () => ({ canApplyForMembership: () => true }))
import { ProSidebar } from './ProSidebar'
import { ZOOMA_ADDRESS } from '../../lib/membaDAO'
function mount(connected = false, address: string | null = null) {
    return render(<MemoryRouter initialEntries={['/mainnet/settings']}><ProSidebar connected={connected} address={address} collapsed={false} onToggleCollapse={() => {}} unvotedCount={2} notifUnreadCount={1} feedReplyUnread={4} /></MemoryRouter>)
}
describe('professional sidebar', () => {
    it('preserves member routes, addressed profile, notifications and active disclosure', () => {
        mount(true, 'g1member')
        expect(screen.getByRole('link', { name: 'Profile', exact: true })).toHaveAttribute('href', '/mainnet/profile/g1member')
        expect(screen.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute('aria-current', 'page')
        expect(screen.getByRole('link', { name: 'Organizations', exact: true })).toHaveAttribute('href', '/mainnet/organizations')
        expect(screen.getByRole('link', { name: 'DAOs, 3 notifications' })).toBeInTheDocument()
        expect(screen.getByRole('link', { name: /Feed.*4 notifications/ })).toBeInTheDocument()
        expect(screen.queryByRole('link', { name: 'Quest Admin' })).not.toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Memba home' })).toHaveAttribute('href', '/mainnet/')
    })
    it('keeps account-only destinations hidden from visitors', () => {
        mount()
        expect(screen.queryByRole('link', { name: 'Multisig' })).not.toBeInTheDocument()
        expect(screen.queryByRole('link', { name: 'Organizations' })).not.toBeInTheDocument()
        expect(screen.queryByRole('link', { name: 'Profile' })).not.toBeInTheDocument()
    })
    it('keeps the existing admin address gate and opens the real search action', () => {
        mount(true, ZOOMA_ADDRESS)
        expect(screen.getByRole('link', { name: 'Quest Admin' })).toHaveAttribute('href', '/mainnet/quest-admin')
        const opened = vi.fn(); window.addEventListener('open-command-palette', opened)
        fireEvent.click(screen.getByRole('button', { name: 'Search and quick actions' }))
        expect(opened).toHaveBeenCalledOnce(); window.removeEventListener('open-command-palette', opened)
    })
})
