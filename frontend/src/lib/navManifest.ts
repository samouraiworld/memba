/**
 * navManifest — the SINGLE SOURCE OF TRUTH for primary navigation.
 *
 * Both the desktop `Sidebar` and the upcoming mobile tab bar read from this
 * list so the two can never drift (audit M7). Paths are network-RELATIVE
 * (e.g. "/dao"); consumers prefix the active network key at render time
 * (`/${networkKey}${entry.to}`), exactly as `SidebarLink` already does.
 *
 * This module is intentionally presentation-light: it carries the canonical
 * route + label + icon + grouping + visibility/auth metadata. Per-entry chrome
 * that is surface-specific (live badges, "coming soon" pills, the collapsible
 * Extensions disclosure, admin-only links) stays in the rendering component.
 */
import type { Icon } from '@phosphor-icons/react'
import {
    House, ChartBar, Buildings, Coins, FolderOpen,
    LinkSimpleHorizontal, Bell, Briefcase, Heart, GameController,
    PuzzlePiece, Robot, Handshake, ImageSquare,
    User, Gear, Bank, Megaphone,
} from '@phosphor-icons/react'

export type NavGroup = 'primary' | 'manage' | 'account'
export type NavShowOn = 'both' | 'mobile' | 'desktop'
export type NavSurface = 'desktop' | 'mobile'

export interface NavEntry {
    /** Stable id (used as React key and for tab selection). */
    id: string
    /** Network-relative path; prefix `/${networkKey}` at render time. */
    to: string
    label: string
    Icon: Icon
    group: NavGroup
    showOn: NavShowOn
    /** Entry is only meaningful for a connected wallet. */
    requiresAuth?: boolean
    /** Env flag that gates a "coming soon" entry (rendered but badged). */
    flag?: string
}

export const NAV: NavEntry[] = [
    // ── Primary ─────────────────────────────────────────────────────
    { id: 'home', to: '/', label: 'Home', Icon: House, group: 'primary', showOn: 'both' },
    { id: 'dashboard', to: '/dashboard', label: 'Dashboard', Icon: ChartBar, group: 'primary', showOn: 'both', requiresAuth: true },
    { id: 'dao', to: '/dao', label: 'DAOs', Icon: Buildings, group: 'primary', showOn: 'both' },
    { id: 'tokens', to: '/tokens', label: 'Tokens', Icon: Coins, group: 'primary', showOn: 'both' },
    { id: 'directory', to: '/directory', label: 'Directory', Icon: FolderOpen, group: 'primary', showOn: 'both' },
    { id: 'validators', to: '/validators', label: 'Validators', Icon: LinkSimpleHorizontal, group: 'primary', showOn: 'both' },
    { id: 'alerts', to: '/alerts', label: 'Alerts', Icon: Bell, group: 'primary', showOn: 'both' },
    { id: 'gnolove', to: '/gnolove', label: 'Gnolove', Icon: Heart, group: 'primary', showOn: 'both' },
    { id: 'quests', to: '/quests', label: 'Quests', Icon: GameController, group: 'primary', showOn: 'both' },

    // ── Manage / extend ─────────────────────────────────────────────
    { id: 'multisig', to: '/multisig', label: 'Multisig', Icon: Briefcase, group: 'manage', showOn: 'both', requiresAuth: true },
    { id: 'extensions', to: '/extensions', label: 'Extensions', Icon: PuzzlePiece, group: 'manage', showOn: 'both' },
    { id: 'marketplace', to: '/marketplace', label: 'Marketplace', Icon: Robot, group: 'manage', showOn: 'both', flag: 'VITE_ENABLE_MARKETPLACE' },
    { id: 'services', to: '/services', label: 'Services', Icon: Handshake, group: 'manage', showOn: 'both', flag: 'VITE_ENABLE_SERVICES' },
    { id: 'nft', to: '/nft', label: 'NFT', Icon: ImageSquare, group: 'manage', showOn: 'both', flag: 'VITE_ENABLE_NFT' },

    // ── Account ─────────────────────────────────────────────────────
    { id: 'profile', to: '/profile', label: 'Profile', Icon: User, group: 'account', showOn: 'both', requiresAuth: true },
    { id: 'settings', to: '/settings', label: 'Settings', Icon: Gear, group: 'account', showOn: 'both', requiresAuth: true },
    { id: 'candidature', to: '/candidature', label: 'Candidature', Icon: Bank, group: 'account', showOn: 'both', requiresAuth: true },
    { id: 'feedback', to: '/feedback', label: 'Feedback', Icon: Megaphone, group: 'account', showOn: 'both' },
]

/** Entries visible on a given surface ('both' shows on each). */
export function navForSurface(surface: NavSurface): NavEntry[] {
    return NAV.filter((e) => e.showOn === 'both' || e.showOn === surface)
}

/** Entries of a given group, in manifest order. */
export function navForGroup(group: NavGroup): NavEntry[] {
    return NAV.filter((e) => e.group === group)
}
