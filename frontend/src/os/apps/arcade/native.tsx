/** Arcade: a Cinema storefront for Memba's games. The games themselves remain the existing classic game pages. */
import { isGameEnabled } from "../../../lib/config"
import { resolveMedia } from "../../../lib/storeMedia"
import { MIN_RATED_COUNT } from "../../../components/reviews/AppReviewStars"
import { NextBoardCountdown } from "../../../game/components/NextBoardCountdown"
import { CinemaScope, CinemaShell, CoverCapsule, HeroCarousel, Shelf, useReviewSummaries, type HeroSlide } from "../../kit/storefront"
import { Pill } from "../../kit"
import type { NativeViewProps } from "../../native/types"
import { specForTarget } from "../../shell/windows"
import { ARCADE_GAMES, gameById, gameSection, type ArcadeGame } from "./catalogue"
import { CommunityGames } from "./community"
import { GamePage } from "./GamePage"

const sections = [
    { id: "games", name: "Featured", icon: "game" },
    { id: "runs", name: "Your runs", icon: "prof" },
    { id: "daily-board", name: "Daily board", icon: "chart" },
] as const

/** Text up to and including the first sentence end; never ends in "..". */
const firstSentence = (text: string) => {
    const end = text.indexOf(". ")
    return (end < 0 ? text : text.slice(0, end + 1)).replace(/\.{2,}$/, ".")
}

export default function ArcadeWindow({ section, open, fallback, session, active }: NativeViewProps) {
    const go = (next: string | null) => open(specForTarget({ kind: "app", app: "arcade", section: next })!)
    const summaries = useReviewSummaries(session.network.chainId, ARCADE_GAMES.map((game) => game.reviewSubject))
    if (section?.startsWith("g/")) {
        const game = gameById(section.slice(2))
        return game ? <CinemaScope tone="arcade"><GamePage game={game} session={session} open={open} /></CinemaScope> : <>{fallback}</>
    }
    if (section !== null && !sections.some((entry) => entry.id === section)) return <>{fallback}</>
    const current = section ?? "games"
    const capsule = (game: ArcadeGame) => {
        const media = resolveMedia(game.id, null, game.id)
        const on = game.enabled()
        return <CoverCapsule key={game.id} title={game.name} pitch={game.pitch} cover={media.cover} accent={media.accent} tags={game.tags.slice(0, 1)}
            costTag={game.cost === "staked" ? { label: "Staked · GNOT", tone: "warn" } : on ? { label: "Free", tone: "free" } : { label: "Unavailable", tone: "warn" }}
            summary={summaries.get(game.reviewSubject)} disabled={!on}
            onOpen={() => go(gameSection(game))} onPlay={on ? () => go(game.section) : undefined} />
    }
    const slides: HeroSlide[] = ARCADE_GAMES.filter((game) => game.featured).map((game) => {
        const media = resolveMedia(game.id, null, game.id)
        return {
            id: game.id, kicker: `Featured · ${game.tags.join(" · ")}`, title: game.name, pitch: firstSentence(game.description),
            cover: media.cover, accent: media.accent, tags: game.tags,
            primary: game.enabled() ? { label: "Play now", onClick: () => go(game.section) } : { label: "Details", onClick: () => go(gameSection(game)) },
            secondary: game.enabled() ? { label: "Details", onClick: () => go(gameSection(game)) } : undefined,
        }
    })
    const topRated = ARCADE_GAMES
        .filter((game) => (summaries.get(game.reviewSubject)?.count ?? 0) >= MIN_RATED_COUNT)
        .sort((a, b) => summaries.get(b.reviewSubject)!.average - summaries.get(a.reviewSubject)!.average)

    return <CinemaShell tone="arcade" label="Arcade" brand="Arcade" sections={sections} current={current} onSelect={(next) => go(next === "games" ? null : next)}>
        {current === "games" && <>
            <HeroCarousel label="Featured games" slides={slides} active={active} />
            {isGameEnabled() && <div className="os-cin-daily">
                <p className="os-cin-kicker">Today's daily</p>
                <b>Block Party — the same board for everyone</b>
                <div className="os-cin-countdown"><NextBoardCountdown label="Next daily in" /></div>
                <button type="button" className="os-cin-btn" onClick={() => go("game")}>Play daily</button>
            </div>}
            <Shelf id="arcade-all" title="All games" note="Playing needs no wallet, except Connect 4, which is staked.">
                <div className="os-cin-grid">{ARCADE_GAMES.map(capsule)}</div>
                <p className="os-cin-sub">Posting a Block Party Daily score requires sign-in; its leaderboard is server-verified when Daily is live. A combined Arcade board and on-chain attestation are unavailable. An unavailable game's page explains why.</p>
            </Shelf>
            {topRated.length > 0 && <Shelf id="arcade-top" title="Top rated by the community"><div className="os-cin-grid">{topRated.map(capsule)}</div></Shelf>}
            <CommunityGames />
        </>}
        {current === "runs" && <>
            <h2>Your runs</h2>
            <div className="os-note" role="status">A combined run history is not available yet. Games may keep their own local progress or results; they are not a certified Arcade record.</div>
            <div className="os-cin-grid">{ARCADE_GAMES.map(capsule)}</div>
        </>}
        {current === "daily-board" && <>
            <h2>Daily board</h2>
            <div className="os-note" role="status"><Pill tone="neutral">Not live</Pill>{" "}A combined daily leaderboard and on-chain Arcade attestation are unavailable while Arcade attestation is off. Block Party has its own server-verified Daily leaderboard when Daily is live; open the game to view it.</div>
            <div className="os-cin-grid">{ARCADE_GAMES.map(capsule)}</div>
        </>}
    </CinemaShell>
}
