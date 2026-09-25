/**
 * The Marketplace nav entry on gno.land mainnet, where escrow_v4 is allowlisted:
 * once the Services lane is live (VITE_ENABLE_SERVICES) the entry must not be
 * badged "soon" on any nav surface, even with VITE_ENABLE_MARKETPLACE off.
 * With Services off it keeps today's "soon" badge. (The escrow-not-valid state
 * is covered on test13 in Sidebar.test.tsx.)
 */
import { render, screen, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Pin the module-load active network to mainnet through the URL, before config loads.
vi.hoisted(() => {
    window.history.replaceState(null, '', '/mainnet/')
})

vi.mock('../../hooks/useNetworkNav', () => ({ useNetworkKey: () => 'mainnet' }))
vi.mock('../../lib/quests', () => ({ canApplyForMembership: () => false }))

import { Sidebar } from './Sidebar'
import { MobileTabBar } from './MobileTabBar'
import { ComingSoon } from '../home/ComingSoon'
import { ExploreGrid } from '../home/ExploreGrid'
import { isEscrowValid } from '../../lib/config'

function renderSidebar() {
    return render(
        <MemoryRouter initialEntries={['/mainnet/']}>
            <Sidebar connected={false} address={null} unvotedCount={0} notifUnreadCount={0} collapsed={false} onToggleCollapse={() => {}} />
        </MemoryRouter>,
    )
}

function openMoreSheet() {
    const network = { networkKey: 'mainnet', networks: {}, switchNetwork: () => {} }
    const auth = { token: null, isAuthenticated: false, address: '', loading: false, error: null }
    render(
        <MemoryRouter initialEntries={['/mainnet/']}>
            <MobileTabBar connected={false} address={null} auth={auth as never} network={network} />
        </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: /More/ }))
    return screen.getByRole('dialog', { name: 'More options' })
}

function sidebarMarketplaceLink() {
    const launch = document.querySelector('[data-testid="nav-mode-launch"]') as HTMLElement
    return within(launch).getAllByRole('link').find(a => a.getAttribute('href') === '/mainnet/marketplace')!
}

beforeEach(() => {
    vi.stubEnv('VITE_ENABLE_MARKETPLACE', 'false')
})
afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
})

test('escrow is valid on mainnet (precondition of this file)', () => {
    expect(isEscrowValid()).toBe(true)
})

describe('Services lane live on mainnet', () => {
    beforeEach(() => vi.stubEnv('VITE_ENABLE_SERVICES', 'true'))

    test('the desktop sidebar entry is not badged "soon" and opens the marketplace', () => {
        renderSidebar()
        const link = sidebarMarketplaceLink()
        expect(link).toBeTruthy()
        expect(link.textContent).not.toContain('soon')
    })

    test('the mobile More sheet entry is not badged "soon"', () => {
        const sheet = openMoreSheet()
        const link = within(sheet).getAllByRole('link').find(a => a.getAttribute('href') === '/mainnet/marketplace')!
        expect(link).toBeTruthy()
        expect(link.textContent).not.toContain('soon')
    })

    test('the home Marketplace tile is live, not a "soon" tile', () => {
        render(<ComingSoon />)
        expect(screen.queryByTestId('soon-marketplace')).not.toBeInTheDocument()
        render(<MemoryRouter><ExploreGrid networkKey="mainnet" /></MemoryRouter>)
        expect(screen.getByTestId('explore-marketplace')).toHaveAttribute('href', '/mainnet/marketplace')
    })
})

describe('Services lane off (today\'s behaviour)', () => {
    beforeEach(() => vi.stubEnv('VITE_ENABLE_SERVICES', 'false'))

    test('the desktop sidebar entry keeps its "soon" badge', () => {
        renderSidebar()
        expect(sidebarMarketplaceLink().textContent).toContain('soon')
    })

    test('the mobile More sheet entry keeps its "soon" badge', () => {
        const sheet = openMoreSheet()
        const link = within(sheet).getAllByRole('link').find(a => a.getAttribute('href') === '/mainnet/marketplace')!
        expect(link.textContent).toContain('soon')
    })

    test('the home Marketplace tile stays a "soon" tile', () => {
        render(<ComingSoon />)
        expect(screen.getByTestId('soon-marketplace')).toBeInTheDocument()
    })
})
