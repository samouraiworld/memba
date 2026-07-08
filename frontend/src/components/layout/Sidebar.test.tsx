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

describe('W6.2 — 4-mode IA sections', () => {
    test('renders the four mode sections in order with labels', () => {
        renderSidebar({ connected: true, address: NON_ZOOMA })
        const modes = [...document.querySelectorAll('[data-testid^="nav-mode-"]')]
            .map(el => el.getAttribute('data-testid'))
        expect(modes).toEqual(['nav-mode-wallet', 'nav-mode-govern', 'nav-mode-launch', 'nav-mode-explore'])
        for (const label of ['Wallet', 'Govern', 'Launch', 'Explore']) {
            expect(screen.getByText(label)).toBeTruthy()
        }
    })

    test('mode membership: DAOs under Govern, Marketplace under Launch, Directory under Explore', () => {
        renderSidebar({ connected: true, address: NON_ZOOMA })
        const within = (mode: string, label: string) =>
            !!document.querySelector(`[data-testid="nav-mode-${mode}"]`)?.textContent?.includes(label)
        expect(within('govern', 'DAOs')).toBe(true)
        expect(within('wallet', 'Tokens')).toBe(true)
        expect(within('launch', 'Marketplace')).toBe(true)
        expect(within('explore', 'Directory')).toBe(true)
        // Leaderboard + Extensions moved to the utility tail (no longer in a mode section).
        expect(within('launch', 'Extensions')).toBe(false)
        expect(within('explore', 'Leaderboard')).toBe(false)
    })

    test('flag-gated Launch entries carry a pill (soon when the flag is off)', () => {
        renderSidebar({ connected: false })
        // Test env has no VITE_ENABLE_* set → the flag-gated Launch entries
        // (Marketplace, App Store) render as "soon". NFT/Services are no longer
        // separate entries — they are tabs inside the unified Marketplace.
        const launch = document.querySelector('[data-testid="nav-mode-launch"]')!
        expect(launch.textContent).toContain('Marketplace')
        expect(launch.textContent).toContain('soon')
    })

    test('Feed renders at the top (under Home) with a pill, not inside a mode section', () => {
        renderSidebar({ connected: false })
        // Feed link is present and reachable (its accessible name carries the pill).
        const nav = screen.getByRole('navigation', { name: 'Main' })
        const feedLink = within(nav).getAllByRole('link').find(a => a.getAttribute('href') === '/test13/feed')
        expect(feedLink).toBeTruthy()
        // The pill renders alongside it (flag off in tests → "soon").
        expect(feedLink?.textContent).toContain('soon')
        // …but Feed is NOT inside the Explore mode section anymore.
        const explore = document.querySelector('[data-testid="nav-mode-explore"]')
        expect(explore?.textContent?.includes('Feed')).toBeFalsy()
    })

    test('Leaderboard + Extensions live in the utility tail next to Feedback', () => {
        renderSidebar({ connected: false })
        // All three are reachable public links…
        expect(linkHref('Leaderboard')).toBe('/test13/leaderboard')
        expect(linkHref('Extensions')).toBe('/test13/extensions')
        expect(linkHref('Feedback')).toBe('/test13/feedback')
        // …and none of them sit in a discovery mode section.
        const inAnyMode = (label: string) =>
            [...document.querySelectorAll('[data-testid^="nav-mode-"]')]
                .some(el => el.textContent?.includes(label))
        expect(inAnyMode('Leaderboard')).toBe(false)
        expect(inAnyMode('Extensions')).toBe(false)
    })
})
