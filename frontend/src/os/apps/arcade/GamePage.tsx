/** One Arcade game's page: media, about, reviews, play box, facts. */
import { resolveMedia } from "../../../lib/storeMedia"
import { DetailLayout, InfoRows, MediaGallery, RatingBadge, useReviewSummaries } from "../../kit/storefront"
import type { NativeViewProps } from "../../native/types"
import { specForTarget } from "../../shell/windows"
import { NextBoardCountdown } from "../../../game/components/NextBoardCountdown"
import { ReviewsPanel } from "../store/ReviewsPanel"
import { connect4PathFor, isRealmValidOn, reviewsPathFor } from "../../../lib/config"
import type { ArcadeGame } from "./catalogue"
import { DailyTop } from "./DailyTop"

export function GamePage({ game, session, open, toLobby }: { game: ArcadeGame; toLobby: () => void } & Pick<NativeViewProps, "session" | "open">) {
    const media = resolveMedia(game.id, null, game.id)
    // Connect 4 is reviewed only where both its realm and the reviews realm are listed.
    const network = session.network.key
    const c4Realm = game.id !== "connect4" || connect4PathFor(network) !== null
    const reviewSubject = c4Realm && (game.id !== "connect4" || isRealmValidOn(network, reviewsPathFor(network))) ? game.reviewSubject : null
    const summaries = useReviewSummaries(session.network.chainId, reviewSubject ? [reviewSubject] : [])
    const summary = reviewSubject ? summaries.get(reviewSubject) : undefined
    const enabled = game.enabled()
    const play = () => open(specForTarget({ kind: "app", app: "arcade", section: game.section })!)
    return <DetailLayout banner={media.cover} accent={media.accent} back={{ label: "← Arcade", onClick: toLobby }} title={game.name} pitch={game.pitch}
        badges={<><RatingBadge summary={summary} />{game.tags.map((tag) => <span key={tag} className="os-cin-tag">{tag}</span>)}</>}
        main={<>
            <MediaGallery name={game.name} images={media.screenshots} />
            <section className="os-cin-panel"><h2>About this game</h2><p>{game.description}</p>
                {game.howTo.length > 0 && <ol className="os-cin-steps">{game.howTo.map((step) => <li key={step}>{step}</li>)}</ol>}</section>
            {/* The reviews list renders its own "Reviews" heading, so this section is labelled rather than headed. */}
            <section className="os-cin-panel" aria-label="Ratings and reviews">
                {reviewSubject
                    ? <ReviewsPanel subject={reviewSubject} name={game.name} session={session} composable={enabled} />
                    : <p className="os-cin-sub">{c4Realm ? "Onchain reviews are not available here yet." : `Reviews open once ${game.name} is live on mainnet.`}</p>}</section>
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
            {game.dailyBoard && enabled && <DailyTop chainId={session.network.chainId} onOpen={play} />}
            {game.daily && <p className="os-cin-sub" role="note">A combined daily leaderboard and on-chain Arcade attestation are unavailable while Arcade attestation is off.</p>}
        </>} />
}
