import { useState } from "react"
import { githubLinkAvailable, startGithubLink } from "../../../lib/githubLink"
import { updateBackendProfile, type UserProfile } from "../../../lib/profile"
import { safeProfileUrl } from "../../profile/profileData"
import type { OsSession } from "../../shell/useOsSession"

/**
 * The owner's GitHub link. A link made here is checked by the backend with
 * GitHub and stored on the wallet's Memba profile, so only that link can be
 * removed here; one that comes from Gnolove is shown as it is. A build without
 * the OAuth app's client id shows nothing.
 */
export function GithubLink({ address, legacy, session, onChanged, go }: {
    address: string
    legacy: UserProfile
    session: OsSession
    onChanged: () => void
    /** Where the browser goes to reach GitHub (a test seam). */
    go?: (url: string) => void
}) {
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    if (!githubLinkAvailable()) return null
    const token = session.layout.auth.token
    const linked = legacy.membaGithub
    const linkedUrl = linked ? safeProfileUrl(linked.startsWith("https://") ? linked : `https://github.com/${linked.replace(/^@/, "")}`) : null
    const run = async (action: () => Promise<void>, failure: string) => {
        if (!token) { session.openConnect(); return }
        setBusy(true)
        setError(null)
        try { await action() } catch { setError(failure); setBusy(false) }
    }
    const link = () => run(() => startGithubLink(token!, address, go), "Could not start the GitHub link. Try again.")
    const unlink = () => run(async () => { await updateBackendProfile(token!, { github: "" }); setBusy(false); onChanged() }, "Could not unlink GitHub. Try again.")

    return <section className="os-profile-section" data-testid="os-profile-github">
        <h3>GitHub</h3>
        {linked ? <>
            <p>Linked to {linkedUrl ? <a href={linkedUrl} target="_blank" rel="noopener noreferrer">{linked.replace(/^https:\/\/github\.com\//, "@")} ↗</a> : linked}.</p>
            <button type="button" className="os-btn os-quiet" disabled={busy} onClick={() => void unlink()}>{busy ? "Unlinking…" : "Unlink GitHub"}</button>
        </> : !legacy.githubLogin && <>
            <p>Link your GitHub account to show that it is yours. GitHub asks you to sign in there, then brings you back to this profile.</p>
            <button type="button" className="os-btn" disabled={busy} onClick={() => void link()}>{busy ? "Opening GitHub…" : "Link GitHub"}</button>
        </>}
        {legacy.githubLogin && <p>@{legacy.githubLogin} is linked through Gnolove.</p>}
        {error && <p role="alert">{error}</p>}
    </section>
}
