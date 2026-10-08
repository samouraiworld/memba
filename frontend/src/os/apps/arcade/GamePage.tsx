/** One Arcade game's page: media, about, reviews, play box, facts. */
import { resolveMedia } from "../../../lib/storeMedia"
import { DetailLayout, InfoRows, MediaGallery, RatingBadge, useReviewSummaries } from "../../kit/storefront"
import type { NativeViewProps } from "../../native/types"
import { specForTarget } from "../../shell/windows"
import { NextBoardCountdown } from "../../../game/components/NextBoardCountdown"
import { ReviewsPanel } from "../store/ReviewsPanel"
import type { ArcadeGame } from "./catalogue"
import { DailyTop } from "./DailyTop"

export function GamePage({ game, session, open }: { game: ArcadeGame } & Pick<NativeViewProps, "session" | "open">) {
    const media = resolveMedia(game.id, null, game.id)
    const summary = useReviewSummaries(session.network.chainId, [game.reviewSubject]).get(game.reviewSubject)
    const enabled = game.enabled()
    const play = () => open(specForTarget({ kind: "app", app: "arcade", section: game.section })!)
    const back = () => open(specForTarget({ kind: "app", app: "arcade", section: null })!)
    const latest = game.changelog[0]
    return <DetailLayout banner={media.cover} accent={media.accent} back={{ label: "← Arcade", onClick: back }} title={game.name} pitch={game.pitch}
        badges={<><RatingBadge summary={summary} />{game.tags.map((tag) => <span key={tag} className="os-cin-tag">{tag}</span>)}</>}
        main={<>
            <MediaGallery name={game.name} images={media.screenshots} />
            <section className="os-cin-panel"><h2>About this game</h2><p>{game.description}</p>
                {game.howTo.length > 0 && <ol className="os-cin-steps">{game.howTo.map((step) => <li key={step}>{step}</li>)}</ol>}</section>
            {latest && <section className="os-cin-panel"><h2>What's new</h2><p><b>{latest.version}</b> · {latest.date} — {latest.note}</p></section>}
            {/* The reviews list renders its own "Reviews" heading, so this section is labelled rather than headed. */}
            <section className="os-cin-panel" aria-label="Ratings and reviews">
                <ReviewsPanel subject={game.reviewSubject} name={game.name} session={session} composable={enabled} /></section>
        </>}
        side={<>
            <div className="os-cin-panel">
                {enabled ? <>
                    {game.daily && <div className="os-cin-countdown"><NextBoardCountdown label="Next daily in" /></div>}
                    <button type="button" className="os-cin-btn os-cin-btn--play" onClick={play} aria-label={`Play ${game.name}`}>Play</button>
                    <p className="os-cin-sub">{game.cost === "staked" ? "Connect a wallet to stake and play. You can watch games without one." : "No wallet needed to play."}</p>
                </> : <>
                    <p className="os-cin-sub" role="status">This game is unavailable in this build.</p>
                    <button type="button" className="os-cin-btn" onClick={play}>See why</button>
                </>}
            </div>
            <div className="os-cin-panel"><InfoRows rows={game.info} /></div>
            {game.dailyBoard && enabled && <DailyTop onOpen={play} />}
            <p className="os-cin-sub" role="note">A combined daily leaderboard and on-chain Arcade attestation are unavailable while Arcade attestation is off.</p>
        </>} />
}
