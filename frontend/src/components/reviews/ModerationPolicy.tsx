/**
 * ModerationPolicy: what a flag and a hide do in the reviews realm, who its moderator
 * is, and, when that is the Samourai team multisig, its grounds for hiding and where to
 * appeal. The realm has no automatic hide and takes no reason with one, so the grounds
 * are that moderator's policy; nothing is stated about another moderator's.
 */
import { TEAM_MULTISIG_ADDRESS } from "../../lib/reviews"
import { useReviewsModerator } from "./useReviewsModerator"
import "./reviews.css"

const APPEALS_URL = "https://github.com/samouraiworld/memba/issues"

export function ModerationPolicy({ moderator }: { moderator: string }) {
  const team = moderator === TEAM_MULTISIG_ADDRESS
  return (
    <details className="reviews-policy">
      <summary><h3>How reviews are moderated</h3></summary>
      <ul>
        {team && <li>The moderator hides a review or a reply only for illegal content, personal data, scams, spam or harassment. Criticism or a low rating is never a reason.</li>}
        <li>A flag is recorded for the moderator. It never hides anything by itself.</li>
        <li>A hidden review leaves this list and the average, and a hidden reply leaves its thread. The text stays on chain, and every hide is a public chain event from the moderator.</li>
        <li>The moderator is {team ? "the Samourai team multisig" : "this address"}: <code>{moderator}</code>. It acts by a chain transaction of its own, so this page has no hide control.</li>
        {team && <li>To appeal a hide, open an issue at <a href={APPEALS_URL} target="_blank" rel="noopener noreferrer">{APPEALS_URL.replace("https://", "")}</a>. The same team answers it.</li>}
      </ul>
    </details>
  )
}

/**
 * What every review list ends with: the policy when the reviews realm returned its
 * moderator, one sentence when it returned none, nothing while the read is pending.
 */
export function ReviewsModeration({ realmPath, enabled = true }: { realmPath?: string; enabled?: boolean }) {
  const moderator = useReviewsModerator(realmPath, enabled)
  if (moderator === undefined) return null
  return moderator
    ? <ModerationPolicy moderator={moderator} />
    : <p className="reviews-policy">How these reviews are moderated cannot be shown: the reviews realm did not return its moderator.</p>
}
