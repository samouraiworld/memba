/**
 * homeSurfaces — single source of truth for the below-the-fold surface tiles.
 *
 * Every user-facing surface is declared once with a call-time `live()` flag
 * read; the live ones render as navigable tiles in <ExploreGrid>, the gated
 * ones as clearly-labelled "soon" tiles in <ComingSoon>. The two June-era
 * static lists drifted from reality (the marketplace shipped but stayed
 * "not live yet" here) — deriving both sections from one manifest makes that
 * contradiction impossible.
 */
import type { Icon } from "@phosphor-icons/react"
import {
    Wallet,
    Users,
    Globe,
    Heart,
    Trophy,
    Vault,
    Storefront,
    SquaresFour,
    Article,
    Alien,
    ChatCircleText,
    GridFour,
    Briefcase,
    PuzzlePiece,
    Medal,
} from "@phosphor-icons/react"
import {
    isMarketplaceEnabled,
    isAppStoreEnabled,
    isSpaceInvadersEnabled,
    isFeedEnabled,
    isGameEnabled,
    isServicesEnabled,
    isAgentsEnabled,
    isPointsEnabled,
} from "../../lib/config"

export interface HomeSurface {
    /** testid suffix (`explore-<key>` / `soon-<key>`) */
    key: string
    /** network-relative route the live tile links to */
    route: string
    label: string
    sub: string
    Icon: Icon
    /** call-time flag read — evaluated at render so tests can stub envs */
    live: () => boolean
}

const always = () => true

export const HOME_SURFACES: HomeSurface[] = [
    { key: "tokens", route: "tokens", label: "Tokens", sub: "create & explore", Icon: Wallet, live: always },
    { key: "directory", route: "directory", label: "Directory", sub: "find anyone", Icon: Users, live: always },
    { key: "validators", route: "validators", label: "Validators", sub: "network set", Icon: Globe, live: always },
    { key: "gnolove", route: "gnolove", label: "Gnolove", sub: "contributor board", Icon: Heart, live: always },
    { key: "quests", route: "quests", label: "Quests", sub: "earn XP", Icon: Trophy, live: always },
    { key: "multisig", route: "multisig", label: "Multisig", sub: "shared treasury", Icon: Vault, live: always },
    { key: "marketplace", route: "marketplace", label: "Marketplace", sub: "NFTs, tokens & services", Icon: Storefront, live: isMarketplaceEnabled },
    { key: "apps", route: "apps", label: "App Store", sub: "community apps, on-chain", Icon: SquaresFour, live: isAppStoreEnabled },
    { key: "blog", route: "blog", label: "Blog", sub: "news & deep dives", Icon: Article, live: always },
    { key: "space-invaders", route: "game/space-invaders", label: "Space Invaders", sub: "daily arcade run", Icon: Alien, live: isSpaceInvadersEnabled },
    { key: "feed", route: "feed", label: "Social feed", sub: "posts, on-chain", Icon: ChatCircleText, live: isFeedEnabled },
    { key: "game", route: "game", label: "Block Party", sub: "chain-seeded daily puzzle", Icon: GridFour, live: isGameEnabled },
    { key: "services", route: "marketplace/services", label: "Services", sub: "freelance marketplace", Icon: Briefcase, live: isServicesEnabled },
    { key: "agents", route: "marketplace/agents", label: "Agent credits", sub: "on-chain AI agents", Icon: PuzzlePiece, live: isAgentsEnabled },
    { key: "points", route: "points", label: "Reputation", sub: "rank & reputation", Icon: Medal, live: isPointsEnabled },
]

/** Surfaces that are live under the current flags — rendered by <ExploreGrid>. */
export const liveSurfaces = (): HomeSurface[] => HOME_SURFACES.filter((s) => s.live())

/** Gated surfaces — rendered by <ComingSoon> as non-navigable "soon" tiles. */
export const upcomingSurfaces = (): HomeSurface[] => HOME_SURFACES.filter((s) => !s.live())
