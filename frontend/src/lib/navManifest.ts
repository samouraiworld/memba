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
    PuzzlePiece, Robot,
    User, Gear, Bank, Megaphone,
    UsersThree, Trophy, ClockCounterClockwise, ShieldStar, Newspaper,
    ChatCircle, Storefront,
} from '@phosphor-icons/react'

/** W6.2 4-mode IA: the nav IS the positioning statement. Every primary
 *  destination lives in exactly one mode; 'account' is the bottom-pinned tail. */
export type NavGroup = 'wallet' | 'govern' | 'launch' | 'explore' | 'account'

/** Ordered mode sections the sidebar renders (account is rendered separately). */
export const MODE_SECTIONS: { key: NavGroup; label: string }[] = [
    { key: 'wallet', label: 'Wallet' },
    { key: 'govern', label: 'Govern' },
    { key: 'launch', label: 'Launch' },
    { key: 'explore', label: 'Explore' },
]
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
    // ── Modes (Wallet / Govern / Launch / Explore) — W6.2 IA ────────
    { id: 'home', to: '/', label: 'Home', Icon: House, group: 'explore', showOn: 'both' },
    // Feed is a top-of-nav companion to Home (rendered directly under it in the
    // sidebar, above the mode sections — see Sidebar). Group stays 'explore' for
    // the mobile overflow list; the desktop sidebar pulls it to the top block.
    { id: 'feed', to: '/feed', label: 'Feed', Icon: ChatCircle, group: 'explore', showOn: 'both', flag: 'VITE_ENABLE_FEED' },
    { id: 'dashboard', to: '/dashboard', label: 'Dashboard', Icon: ChartBar, group: 'wallet', showOn: 'both', requiresAuth: true },
    { id: 'dao', to: '/dao', label: 'DAOs', Icon: Buildings, group: 'govern', showOn: 'both' },
    { id: 'tokens', to: '/tokens', label: 'Tokens', Icon: Coins, group: 'wallet', showOn: 'both' },
    // Directory is the single discovery hub — the realm Explorer was merged in as
    // its gated `?tab=explorer` tab (2026-07-08), so there is no separate nav entry.
    { id: 'directory', to: '/directory', label: 'Directory', Icon: FolderOpen, group: 'explore', showOn: 'both' },
    { id: 'validators', to: '/validators', label: 'Validators', Icon: LinkSimpleHorizontal, group: 'govern', showOn: 'both' },
    { id: 'alerts', to: '/alerts', label: 'Alerts', Icon: Bell, group: 'govern', showOn: 'both' },
    { id: 'gnolove', to: '/gnolove', label: 'Gnolove', Icon: Heart, group: 'explore', showOn: 'both' },
    { id: 'quests', to: '/quests', label: 'Quests', Icon: GameController, group: 'explore', showOn: 'both' },

    // ── (former manage group — now mode-assigned above/below) ───────
    { id: 'multisig', to: '/multisig', label: 'Multisig', Icon: Briefcase, group: 'wallet', showOn: 'both', requiresAuth: true },
    // Leaderboard + Extensions live with the account/utility tail (near Feedback
    // in the bottom-pinned sidebar block), not in a discovery mode section.
    { id: 'leaderboard', to: '/leaderboard', label: 'Leaderboard', Icon: Trophy, group: 'account', showOn: 'both' },
    { id: 'extensions', to: '/extensions', label: 'Extensions', Icon: PuzzlePiece, group: 'account', showOn: 'both' },
    { id: 'organizations', to: '/organizations', label: 'Organizations', Icon: UsersThree, group: 'govern', showOn: 'both', requiresAuth: true },
    // One Marketplace entry — NFTs, Services, and Tokens are tabs (lanes) inside
    // the unified /marketplace shell, not separate nav items. The former standalone
    // NFT + Services entries were redirect-only duplicates (/nft → /marketplace/nfts,
    // /services → /marketplace/services), so they were removed here (2026-07-08).
    { id: 'marketplace', to: '/marketplace', label: 'Marketplace', Icon: Robot, group: 'launch', showOn: 'both', flag: 'VITE_ENABLE_MARKETPLACE' },
    { id: 'appstore', to: '/apps', label: 'App Store', Icon: Storefront, group: 'launch', showOn: 'both', flag: 'VITE_ENABLE_APPSTORE' },

    // ── Account ─────────────────────────────────────────────────────
    { id: 'profile', to: '/profile', label: 'Profile', Icon: User, group: 'account', showOn: 'both', requiresAuth: true },
    { id: 'settings', to: '/settings', label: 'Settings', Icon: Gear, group: 'account', showOn: 'both', requiresAuth: true },
    { id: 'candidature', to: '/candidature', label: 'Candidature', Icon: Bank, group: 'account', showOn: 'both', requiresAuth: true },
    { id: 'feedback', to: '/feedback', label: 'Feedback', Icon: Megaphone, group: 'account', showOn: 'both' },
    { id: 'changelogs', to: '/changelogs', label: 'Changelogs', Icon: ClockCounterClockwise, group: 'account', showOn: 'both' },
    { id: 'blog', to: '/blog', label: 'Blog', Icon: Newspaper, group: 'explore', showOn: 'both' },
    { id: 'quest-admin', to: '/quest-admin', label: 'Quest Admin', Icon: ShieldStar, group: 'account', showOn: 'desktop', requiresAuth: true },
]

/** Entries visible on a given surface ('both' shows on each). */
export function navForSurface(surface: NavSurface): NavEntry[] {
    return NAV.filter((e) => e.showOn === 'both' || e.showOn === surface)
}

/** Entries of a given group, in manifest order. */
export function navForGroup(group: NavGroup): NavEntry[] {
    return NAV.filter((e) => e.group === group)
}

// ── Mobile tab-bar selection (route-mapped set) ──────────────────────
// The bottom tab bar and its "More" sheet are CURATED views over the same
// manifest, so route/label/icon live in one place (no Sidebar↔tab-bar drift).
// Ordered id lists below preserve today's behaviour; only `alerts` is
// relabelled "Activity" in the member primary set (a presentation override
// applied by the tab bar, not stored here).
const byId = (id: string): NavEntry | undefined => NAV.find((e) => e.id === id)
const resolve = (ids: string[]): NavEntry[] => ids.map(byId).filter((e): e is NavEntry => !!e)

const PRIMARY_TABS_VISITOR = ['home', 'dao', 'tokens', 'directory']
const PRIMARY_TABS_MEMBER = ['home', 'dao', 'tokens', 'alerts']
// Overflow nav for the "More" sheet. Carries every sidebar destination that
// isn't a primary tab so nothing is desktop-only — including the Launch group
// (`marketplace`, `appstore`), which otherwise had no mobile entry point at all.
// Per-audience primary tabs are filtered out at render time so nothing is shown
// twice (see mobileMoreNav).
const MORE_NAV_IDS = ['dashboard', 'directory', 'marketplace', 'appstore', 'validators', 'gnolove', 'quests', 'feed', 'blog', 'changelogs', 'extensions', 'alerts']
const MORE_ACCOUNT_IDS = ['profile', 'settings', 'multisig', 'feedback']

const visibleFor = (connected: boolean) => (e: NavEntry) => !e.requiresAuth || connected

/** Ordered primary bottom-tab destinations (visitor vs connected member). */
export function mobilePrimaryTabs(connected: boolean): NavEntry[] {
    return resolve(connected ? PRIMARY_TABS_MEMBER : PRIMARY_TABS_VISITOR)
}

/** "More" sheet → Navigate section (overflow nav not in the primary tabs). */
export function mobileMoreNav(connected: boolean): NavEntry[] {
    const primaryIds = new Set(mobilePrimaryTabs(connected).map((e) => e.id))
    return resolve(MORE_NAV_IDS)
        .filter(visibleFor(connected))
        .filter((e) => !primaryIds.has(e.id))
}

/** "More" sheet → Account section. */
export function mobileMoreAccount(connected: boolean): NavEntry[] {
    return resolve(MORE_ACCOUNT_IDS).filter(visibleFor(connected))
}
