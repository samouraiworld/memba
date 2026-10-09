import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { MEMBA_COMMUNITY_COPY, MEMBA_COMMUNITY_LINKS, MEMBA_COMMUNITY_TITLE } from "../../lib/membaCommunity"
import { isWalletRequestPending, subscribeWalletActivity } from "../../lib/walletActivity"
import { useSigner } from "../sign/signerContext"
import { markCommunityNewsRead, markCommunityNewsShown, useCommunityNewsState } from "./newsState"
import "./communityNews.css"

export function CommunityLinks() {
    return <nav className="os-community-links" aria-label="Memba community channels">
        {MEMBA_COMMUNITY_LINKS.map(({ href, label }) => <a key={href} className="os-btn os-quiet" href={href} target="_blank" rel="noopener noreferrer" onClick={markCommunityNewsRead}>{label} <span aria-hidden="true">↗</span></a>)}
    </nav>
}

/** Permanent announcement: reading it in News or Notifications suppresses the automatic card. */
export function CommunityNews({ active = true }: { active?: boolean }) {
    useEffect(() => { if (active) markCommunityNewsRead() }, [active])
    return <section className="os-community-card" aria-label="Memba community news">
        <p className="os-community-kicker">Community news</p>
        <h2>{MEMBA_COMMUNITY_TITLE}</h2>
        <p>{MEMBA_COMMUNITY_COPY}</p>
        <CommunityLinks />
    </section>
}

export const COMMUNITY_NEWS_DELAY = 20_000

/** Non-modal: does not take keyboard focus, and waits out boot/connect/signing and recent input. */
export function CommunityNewsPrompt({ enabled, openNews }: { enabled: boolean; openNews: () => void }) {
    const state = useCommunityNewsState()
    const signer = useSigner()
    const walletBusy = useSyncExternalStore(subscribeWalletActivity, isWalletRequestPending, () => false)
    const [visible, setVisible] = useState(false)
    const lastInput = useRef(0)
    const ready = enabled && !walletBusy && signer.pending.length === 0
    useEffect(() => {
        const input = () => { lastInput.current = Date.now() }
        window.addEventListener("pointerdown", input)
        window.addEventListener("keydown", input)
        window.addEventListener("wheel", input, { passive: true })
        return () => {
            window.removeEventListener("pointerdown", input)
            window.removeEventListener("keydown", input)
            window.removeEventListener("wheel", input)
        }
    }, [])
    useEffect(() => {
        if (!ready || state !== "new") return
        let timer: ReturnType<typeof setTimeout>
        const show = () => {
            if (document.hidden || document.querySelector('[aria-modal="true"]') || Date.now() - lastInput.current < 2_000) {
                timer = setTimeout(show, 1_000)
                return
            }
            // Persist presentation too: reloading without clicking must not show it again.
            if (markCommunityNewsShown()) setVisible(true)
        }
        timer = setTimeout(show, COMMUNITY_NEWS_DELAY)
        return () => clearTimeout(timer)
    }, [ready, state])
    if (!visible || !ready || state === "read") return null
    return <aside className="os-community-prompt os-glass" aria-label="News announcement">
        <button type="button" className="os-community-close os-btn os-quiet" aria-label="Dismiss community news" onClick={() => { setVisible(false); markCommunityNewsRead() }}>×</button>
        <div role="status">
            <p className="os-community-kicker">News</p>
            <h2>{MEMBA_COMMUNITY_TITLE}</h2>
            <p>{MEMBA_COMMUNITY_COPY}</p>
        </div>
        <CommunityLinks />
        <button type="button" className="os-btn os-quiet" onClick={() => { setVisible(false); markCommunityNewsRead(); openNews() }}>Read in News</button>
    </aside>
}
