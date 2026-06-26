import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'

let mobile = true
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => mobile }))
vi.mock('../../hooks/useNetworkNav', () => ({ useNetworkKey: () => 'test13' }))

// useHomeActions does react-query fetches; stub it so the FAB's badge counts are
// deterministic and the test never needs a QueryClientProvider.
const home: { actions: Array<{ kind: string; id: string }> } = { actions: [] }
vi.mock('../../hooks/home/useHomeActions', () => ({ useHomeActions: () => home }))

import { ActFab } from './ActFab'

const authStub = { token: null, isAuthenticated: true, address: 'g1abc', loading: false, error: null }

function renderFab(connected: boolean) {
    return render(
        <MemoryRouter initialEntries={['/test13/']}>
            <ActFab connected={connected} auth={authStub as never} />
        </MemoryRouter>,
    )
}

afterEach(() => { mobile = true; home.actions = []; vi.clearAllMocks() })

describe('ActFab (mobile quick-action FAB)', () => {
    test('renders nothing when disconnected (all actions require auth)', () => {
        renderFab(false)
        expect(screen.queryByRole('button', { name: /quick actions/i })).toBeNull()
    })

    test('renders nothing on desktop (mobile-only chrome must not fetch/show)', () => {
        mobile = false
        renderFab(true)
        expect(screen.queryByRole('button', { name: /quick actions/i })).toBeNull()
    })

    test('connected: the FAB opens a sheet with the four network-prefixed actions', () => {
        renderFab(true)
        const fab = screen.getByRole('button', { name: /quick actions/i })
        expect(fab).toBeInTheDocument()

        fireEvent.click(fab)
        const sheet = screen.getByRole('dialog')
        expect(sheet).toHaveAttribute('aria-modal', 'true')

        const href = (label: string) =>
            within(sheet).getByRole('link', { name: label }).getAttribute('href')
        expect(href('Sign')).toBe('/test13/multisig')
        expect(href('Vote')).toBe('/test13/dashboard')
        expect(href('Candidature')).toBe('/test13/candidature')
        expect(href('Claim')).toBe('/test13/quests')
    })

    test('selecting an action closes the sheet', () => {
        renderFab(true)
        fireEvent.click(screen.getByRole('button', { name: /quick actions/i }))
        const sheet = screen.getByRole('dialog')
        fireEvent.click(within(sheet).getByRole('link', { name: 'Sign' }))
        expect(sheet).toHaveAttribute('aria-modal', 'false')
    })

    test('shows pending counts: total on the FAB and per-action in the sheet', () => {
        home.actions = [
            { kind: 'vote', id: 'v1' },
            { kind: 'vote', id: 'v2' },
            { kind: 'sign', id: 's1' },
        ]
        renderFab(true)
        const fab = screen.getByRole('button', { name: /quick actions/i })
        // Total pending badge on the button.
        expect(within(fab).getByText('3')).toBeInTheDocument()

        fireEvent.click(fab)
        const sheet = screen.getByRole('dialog')
        expect(within(within(sheet).getByRole('link', { name: /Vote/ })).getByText('2')).toBeInTheDocument()
        expect(within(within(sheet).getByRole('link', { name: /Sign/ })).getByText('1')).toBeInTheDocument()
    })
})
