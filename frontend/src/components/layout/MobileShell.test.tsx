import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test, vi } from 'vitest'

// If MobileShell ever imported the Sidebar, this marker would surface it — the
// whole point of the split is that the mobile shell renders NO desktop sidebar.
vi.mock('./Sidebar', () => ({
    Sidebar: () => <nav data-testid="sidebar-marker">SIDEBAR</nav>,
}))

import { MobileShell } from './MobileShell'

describe('MobileShell', () => {
    test('wraps content in the main column WITHOUT the desktop sidebar', () => {
        render(
            <MemoryRouter>
                <MobileShell>
                    <div data-testid="content">HELLO</div>
                </MobileShell>
            </MemoryRouter>,
        )
        expect(screen.getByTestId('content').closest('.k-main-column')).not.toBeNull()
        expect(screen.queryByTestId('sidebar-marker')).toBeNull()
    })
})
