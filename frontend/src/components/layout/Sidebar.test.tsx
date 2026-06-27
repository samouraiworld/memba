import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'

// Hooks the Sidebar depends on — pin the network key and the candidature gate
// so the rendered nav is deterministic.
vi.mock('../../hooks/useNetworkNav', () => ({ useNetworkKey: () => 'test13' }))
vi.mock('../../lib/quests', () => ({ canApplyForMembership: () => false }))

import { Sidebar } from './Sidebar'

const NON_ZOOMA = 'g1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'

function renderSidebar(props: Partial<Parameters<typeof Sidebar>[0]> = {}) {
    const full = {
        connected: false,
        address: null as string | null,
        unvotedCount: 0,
        notifUnreadCount: 0,
        collapsed: false,
        onToggleCollapse: () => {},
        ...props,
    }
    return render(
        <MemoryRouter initialEntries={['/test13/']}>
            <Sidebar {...full} />
        </MemoryRouter>,
    )
}

/** Map of the link label → expected network-prefixed href. */
function linkHref(label: string): string | null {
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const link = within(nav).queryByRole('link', { name: label })
    return link ? link.getAttribute('href') : null
}

afterEach(() => vi.clearAllMocks())

describe('Sidebar nav (characterization — must survive the manifest refactor)', () => {
    test('visitor (disconnected): shows Home + public nav, hides auth-only links', () => {
        renderSidebar({ connected: false })
        // public links, network-prefixed
        expect(linkHref('Home')).toBe('/test13/')
        expect(linkHref('DAOs')).toBe('/test13/dao')
        expect(linkHref('Tokens')).toBe('/test13/tokens')
        expect(linkHref('Directory')).toBe('/test13/directory')
        expect(linkHref('Validators')).toBe('/test13/validators')
        expect(linkHref('Alerts')).toBe('/test13/alerts')
        expect(linkHref('Gnolove')).toBe('/test13/gnolove')
        expect(linkHref('Quests')).toBe('/test13/quests')
        expect(linkHref('Extensions')).toBe('/test13/extensions')
        expect(linkHref('Feedback')).toBe('/test13/feedback')
        // auth-only links are hidden
        expect(linkHref('Dashboard')).toBeNull()
        expect(linkHref('Multisig')).toBeNull()
        expect(linkHref('Profile')).toBeNull()
        expect(linkHref('Settings')).toBeNull()
        expect(linkHref('Candidature')).toBeNull()
    })

    test('member (connected): shows auth links incl. address-suffixed Profile, hides Home', () => {
        renderSidebar({ connected: true, address: NON_ZOOMA })
        expect(linkHref('Dashboard')).toBe('/test13/dashboard')
        expect(linkHref('Multisig')).toBe('/test13/multisig')
        expect(linkHref('Profile')).toBe(`/test13/profile/${NON_ZOOMA}`)
        expect(linkHref('Settings')).toBe('/test13/settings')
        expect(linkHref('Candidature')).toBe('/test13/candidature')
        // still-public links unchanged
        expect(linkHref('DAOs')).toBe('/test13/dao')
        expect(linkHref('Feedback')).toBe('/test13/feedback')
        // Home is replaced by Dashboard when connected
        expect(linkHref('Home')).toBeNull()
    })
})
