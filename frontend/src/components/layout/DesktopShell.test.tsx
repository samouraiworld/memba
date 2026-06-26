import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test, vi } from 'vitest'

// The shell's contract is "compose a Sidebar + main column"; the Sidebar's own
// nav behaviour is covered by Sidebar.test.tsx, so stub it to a marker here to
// keep this test focused on the shell structure (and off the Sidebar hook tree).
vi.mock('./Sidebar', () => ({
    Sidebar: () => <nav data-testid="sidebar-marker">SIDEBAR</nav>,
}))

import { DesktopShell } from './DesktopShell'

const sidebarProps = {
    connected: false,
    address: null as string | null,
    unvotedCount: 0,
    notifUnreadCount: 0,
    collapsed: false,
    onToggleCollapse: () => {},
}

describe('DesktopShell', () => {
    test('renders the desktop Sidebar and wraps content in the main column', () => {
        render(
            <MemoryRouter>
                <DesktopShell {...sidebarProps}>
                    <div data-testid="content">HELLO</div>
                </DesktopShell>
            </MemoryRouter>,
        )
        expect(screen.getByTestId('sidebar-marker')).toBeInTheDocument()
        expect(screen.getByTestId('content').closest('.k-main-column')).not.toBeNull()
    })
})
