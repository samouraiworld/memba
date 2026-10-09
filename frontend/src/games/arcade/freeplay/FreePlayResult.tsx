import type { FreePlaySession } from './session'
import { useFreePlayResult } from './useFreePlayResult'

/** Dormant result panel; games opt in by injecting a session. No auto-publish. */
export function FreePlayResult({ session }: { session: FreePlaySession }) {
    const view = useFreePlayResult(session)
    const { snapshot, phase } = view
    const busy = phase === 'busy'
    const confirmed = phase === 'confirmed' ? snapshot.result?.receipt : undefined
    return <section aria-label="Save this score onchain" aria-busy={busy}>
        <h3>Your score: {snapshot.input.claimedScore.toLocaleString()}</h3>
        <p>Your game is saved locally. Connecting a wallet is optional.</p>
        {confirmed ? <div role="status">
            <p>Score confirmed on {confirmed.target.chainId}, block {confirmed.height}.</p>
            <p>Run: <code>{confirmed.entry.runID}</code></p>
            {confirmed.txHash && <p>Transaction: <code>{confirmed.txHash}</code></p>}
        </div> : <>
            {snapshot.result?.receipt && <p>Saved receipt — check it again to confirm its current network and account.</p>}
            {phase === 'pending' && (!view.error || view.error === 'confirmation_pending') && <p role="status">Publication requested. Waiting for onchain confirmation.</p>}
            {phase === 'pending' && view.error && view.error !== 'confirmation_pending' && <p role="alert">{view.canReauthorize ? 'This quote expired before any transaction was sent. Review a new quote to continue.' : view.error === 'quote_expired' ? 'This quote expired. Check the saved result to see whether a new quote is available.' : 'Publication needs attention. Check the saved result for an update; your local score is preserved.'}</p>}
            {phase === 'quoted' && view.quote && <div>
                <p>The studio pays. Your charge is 0 GNOT for this quote.</p>
                <details><summary>Studio cost details</summary><p>Fee cap: {view.quote.maxFeeUgnot} ugnot. Deposit cap: {view.quote.maxDepositUgnot} ugnot.</p></details>
                <p>Network: {snapshot.binding?.target.chainId}. Player: <code>{snapshot.binding?.player}</code>.</p>
                <p>Quote expires at {new Date(view.quote.expiresAt * 1000).toISOString()}.</p>
                <button type="button" onClick={() => void session.publish()}>Confirm score publication</button>
            </div>}
            {phase !== 'quoted' && !snapshot.publication && <button type="button" disabled={busy} onClick={() => void session.verify()}>Verify score</button>}
            {(phase === 'verified' || phase === 'pending' && view.canReauthorize) && <button type="button" disabled={busy} onClick={() => void session.quote()}>{view.canReauthorize ? 'Review a new quote' : 'Review publication'}</button>}
            {snapshot.binding && <button type="button" disabled={busy} onClick={() => void session.refresh()}>Check saved result</button>}
            {snapshot.publication && phase === 'error' && <button type="button" disabled={busy} onClick={() => void session.retryPublication()}>Retry the same request</button>}
        </>}
        {phase === 'busy' && <p role="status">Checking your result…</p>}
        {phase === 'error' && <p role="alert">{view.error === 'identity_changed' ? 'Reconnect the wallet and network used for this result, then check again.' : view.error === 'quote_expired' ? 'This quote expired. Review a new quote before publishing.' : 'The request did not complete. Your local score is still saved.'}</p>}
    </section>
}
