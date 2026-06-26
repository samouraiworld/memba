import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../hooks/useNetworkNav', () => ({ useNetworkKey: () => 'test13' }))

import { ActFab } from './ActFab'

function renderFab(connected: boolean) {
    return render(
        <MemoryRouter initialEntries={['/test13/']}>
            <ActFab connected={connected} />
        </MemoryRouter>,
    )
}

afterEach(() => vi.clearAllMocks())

describe('ActFab (mobile quick-action FAB)', () => {
    test('renders nothing when disconnected (all actions require auth)', () => {
        renderFab(false)
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
})
