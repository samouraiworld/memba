import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'

// Pin the network key so the rendered nav is deterministic (same as Sidebar.test).
vi.mock('../../hooks/useNetworkNav', () => ({ useNetworkKey: () => 'test13' }))

import { MobileTabBar } from './MobileTabBar'

const network = { networkKey: 'test13', networks: {}, switchNetwork: () => {} }

function renderBar() {
    return render(
        <MemoryRouter initialEntries={['/test13/']}>
            <MobileTabBar connected={false} address={null} network={network} />
        </MemoryRouter>,
    )
}

afterEach(() => vi.clearAllMocks())

describe('MobileTabBar More sheet — command palette touch entry', () => {
    test('the Search entry dispatches open-command-palette and closes the sheet', () => {
        renderBar()
        // Open the More sheet.
        fireEvent.click(screen.getByRole('button', { name: /More/ }))

        const spy = vi.fn()
        window.addEventListener('open-command-palette', spy)

        const sheet = screen.getByRole('dialog', { name: 'More options' })
        expect(sheet).toHaveAttribute('aria-modal', 'true')

        fireEvent.click(screen.getByRole('button', { name: /Search/ }))

        expect(spy).toHaveBeenCalledTimes(1)
        // Sheet closes after launching search (same UX as the nav links). The
        // BottomSheet stays mounted and hides via CSS, so the close signal is the
        // dialog dropping out of its modal state.
        expect(sheet).toHaveAttribute('aria-modal', 'false')

        window.removeEventListener('open-command-palette', spy)
    })
})
