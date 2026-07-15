/**
 * FeedShareCard — a "Share card" action on a post that renders a branded PNG
 * (Riso Protest light) and hands it to the native share sheet (mobile X /
 * Telegram) or, on desktop, downloads the image + copies the permalink. This is
 * the A1.3 active distribution vector; the crawler OG (A1.2) covers passive link
 * unfurls. Mounted only inside PostCard, which is itself behind VITE_ENABLE_FEED.
 *
 * The image is drawn from the tombstone-safe model in lib/feedShareCard — a
 * hidden/deleted post can never be painted onto a shareable image.
 */
import { useEffect, useRef, useState } from "react"
import { ShareNetwork, Check } from "@phosphor-icons/react"
import { feedPostPermalink } from "../../lib/feedPermalink"
import { buildShareCardModel, drawFeedShareCard, type ShareCardModel } from "../../lib/feedShareCard"

/** Structural subset accepted from both FeedPost and UiPost. */
export interface SharePostInput {
    id: bigint
    author: string
    body: string
    hidden: boolean
    deleted: boolean
    replyCount: number
}

const CARD_W = 1200
const CARD_H = 630

/** Draw the card to an offscreen canvas and return a PNG blob (null if the
 *  runtime has no 2D canvas — the caller then falls back to a text share). */
function renderCardBlob(model: ShareCardModel): Promise<Blob | null> {
    const canvas = document.createElement("canvas")
    canvas.width = CARD_W
    canvas.height = CARD_H
    const ctx = canvas.getContext("2d")
    if (!ctx) return Promise.resolve(null)
    drawFeedShareCard(ctx, model)
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"))
}

function downloadBlob(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function FeedShareCard({ post }: { post: SharePostInput }) {
    const [busy, setBusy] = useState(false)
    const [done, setDone] = useState(false)
    const doneTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

    // Clear the "Shared" flash timer if the card unmounts mid-flash.
    useEffect(() => () => clearTimeout(doneTimer.current), [])

    const flash = () => {
        setDone(true)
        clearTimeout(doneTimer.current)
        doneTimer.current = setTimeout(() => setDone(false), 1600)
    }

    const share = async () => {
        if (busy) return
        setBusy(true)
        try {
            const permalink = feedPostPermalink(post.id)
            const model = buildShareCardModel(
                {
                    author: post.author,
                    body: post.body,
                    hidden: post.hidden,
                    deleted: post.deleted,
                    replyCount: post.replyCount,
                },
                permalink,
            )
            const text = `${model.tomb ? "A post on Memba" : model.bodyText.slice(0, 140)} — via Memba`
            const blob = await renderCardBlob(model)

            const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
            if (blob) {
                const file = new File([blob], `memba-post-${post.id.toString()}.png`, { type: "image/png" })
                // Native share sheet WITH the image (mobile).
                if (nav.share && nav.canShare?.({ files: [file] })) {
                    await nav.share({ files: [file], text, url: permalink })
                    flash()
                    return
                }
                // Desktop: save the PNG + copy the link.
                downloadBlob(blob, file.name)
                try {
                    await navigator.clipboard?.writeText(permalink)
                } catch {
                    /* clipboard blocked — the download still happened */
                }
                flash()
                return
            }

            // No canvas → degrade to a text/link share.
            if (nav.share) await nav.share({ text, url: permalink })
            else await navigator.clipboard?.writeText(permalink)
            flash()
        } catch {
            /* user cancelled the share sheet, or it failed — stay quiet */
        } finally {
            setBusy(false)
        }
    }

    return (
        <button
            type="button"
            className="feed-post__stat feed-post__stat--btn feed-post__sharecard"
            onClick={share}
            disabled={busy}
            aria-label="Share card image of this post"
            title={done ? "Shared" : "Share card"}
            data-testid="feed-share-card-btn"
        >
            {done ? <Check size={15} weight="bold" /> : <ShareNetwork size={15} />}
            {done ? "Shared" : "Share card"}
        </button>
    )
}
