/**
 * Linking a GitHub account to the signed-in wallet's profile. The backend
 * issues an OAuth state bound to this wallet's session; GitHub returns to
 * /github/callback (pages/GithubCallback), where the backend checks the state,
 * confirms the account and stores the link itself. The client never writes it.
 *
 * @module lib/githubLink
 */
import type { Token } from "../gen/memba/v1/memba_pb"
import { API_BASE_URL, GITHUB_OAUTH_CLIENT_ID } from "./config"
import { walletBearer } from "./walletBearer"

/** Whether this build can link GitHub: it needs the OAuth app's client id. */
export function githubLinkAvailable(): boolean {
    return GITHUB_OAUTH_CLIENT_ID !== ""
}

/**
 * Sends the browser to GitHub to link the profile of `address`, the wallet
 * signed in with `token`. Throws, with the browser still here, when the
 * backend issues no state.
 */
export async function startGithubLink(token: Token, address: string, go: (url: string) => void = (url) => { window.location.href = url }): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/github/oauth/state`, { headers: { Authorization: walletBearer(token) } })
    const data = await res.json().catch(() => ({})) as { state?: string; error?: string }
    if (!res.ok || !data.state) throw new Error(data.error || `HTTP ${res.status}`)
    // The callback returns here when the wallet is not connected by then.
    sessionStorage.setItem("returnToProfile", address)
    const redirectUri = encodeURIComponent(`${window.location.origin}/github/callback`)
    go(`https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(GITHUB_OAUTH_CLIENT_ID)}&redirect_uri=${redirectUri}&scope=read:user&state=${encodeURIComponent(data.state)}`)
}
