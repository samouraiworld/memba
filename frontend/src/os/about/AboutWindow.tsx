import { useEffect, useState } from "react"
import { APP_VERSION, isFeedEnabled } from "../../lib/config"
import { COMMUNITY_MEMBERSHIP_COPY, useCommunityMembership } from "../../lib/communityMembership"
import type { OsAppId } from "../apps"
import type { WindowSpec } from "../shell/windows"
import { specForTarget } from "../shell/windows"
import { applyToJoinSpec } from "../daos/joinSpec"
import { ABOUT_LINKS, LICENSE_URL, bootEntryPath, buildCommit } from "./aboutInfo"
import { CooperationEngine } from "./engine/CooperationEngine"
import "./about.css"

function useBuildCommit(): string | null {
    const [commit, setCommit] = useState<string | null>(null)
    useEffect(() => {
        const controller = new AbortController()
        const bootEntry = bootEntryPath()
        void fetch("/build-info.json", { cache: "no-store", signal: controller.signal })
            .then((response) => response.ok ? response.json() as Promise<unknown> : null)
            .then((info) => { if (!controller.signal.aborted) setCommit(buildCommit(info, bootEntry)) })
            .catch(() => { /* The compiled version and selected chain remain available offline. */ })
        return () => controller.abort()
    }, [])
    return commit
}

export function AboutWindow({ chainId, openApp, open }: {
    chainId: string
    openApp: (app: OsAppId) => void
    open: (spec: WindowSpec) => void
}) {
    const commit = useBuildCommit()
    const membership = useCommunityMembership(isFeedEnabled())
    const [markAvailable, setMarkAvailable] = useState(true)
    const [showSupport, setShowSupport] = useState(false)
    return (
        <div className="os-about">
            <header className="os-about-head">
                {markAvailable
                    ? <img src="/brand/os/favicon.svg" alt="" width={56} height={56} onError={() => setMarkAvailable(false)} />
                    : <span className="os-about-mark" aria-hidden="true">M</span>}
                <div>
                    <h2>Memba OS</h2>
                    <p className="os-sub os-mono">Version {APP_VERSION}{commit ? ` · Build ${commit}` : ""} · Chain {chainId}</p>
                </div>
            </header>
            <CooperationEngine chainId={chainId} support={() => setShowSupport(true)} />
            {showSupport && <div className="os-about-support" role="region" aria-label="Support Memba">
                <p>Contribute code, test the tools or discuss backing the project with the crew.</p>
                <a href="https://github.com/samouraiworld/memba/blob/main/CONTRIBUTING.md" target="_blank" rel="noopener noreferrer">Contribution guide (opens in new tab)</a>
                <a href="https://t.me/samouraicoop" target="_blank" rel="noopener noreferrer">Contact the crew (opens in new tab)</a>
                <button type="button" className="os-btn os-quiet" onClick={() => setShowSupport(false)}>Close support options</button>
            </div>}
            <p className="os-about-note" role="note"><strong>Public Beta.</strong> Memba is experimental software. If you make a transaction, use small amounts and check it before signing.</p>
            <div className="os-about-actions">
                <button type="button" className="os-btn" onClick={() => openApp("news")}>Read the blog</button>
                <button type="button" className="os-btn os-quiet" onClick={() => open(specForTarget({ kind: "feedback" })!)}>Send feedback</button>
                {isFeedEnabled() && <button type="button" className="os-btn os-quiet" onClick={() => open(applyToJoinSpec())}>Write a #join post</button>}
            </div>
            {isFeedEnabled() && <p className="os-sub os-flush">{COMMUNITY_MEMBERSHIP_COPY[membership]}</p>}
            <nav className="os-about-links" aria-label="Memba links">
                {ABOUT_LINKS.map(({ label, href }) => <a key={href} href={href} target="_blank" rel="noopener noreferrer">{label}</a>)}
            </nav>
            <p className="os-sub os-about-credit">Built by Samouraï Coop. Open source under the <a href={LICENSE_URL} target="_blank" rel="noopener noreferrer">MIT licence</a>.</p>
        </div>
    )
}
