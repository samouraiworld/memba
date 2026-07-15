/**
 * feedShareCard.ts — pure builder + canvas painter for a branded PNG share card
 * of one feed post (A1.3). This is the *active* distribution vector: a user taps
 * "Share card" and attaches the image to X / Telegram, complementing the passive
 * crawler OG unfurl (A1.2). "Riso Protest" light identity per plan D10.
 *
 * The draw function takes a 2D context so it is unit-testable against a mock ctx
 * (jsdom has no canvas). SAFETY: `buildShareCardModel` suppresses the body of any
 * hidden/deleted post — a tombstoned post can never be painted onto a shareable
 * image. Kept dependency-free (own tiny handle/tombstone helpers) so it stands
 * alone from the edge-fn module, which lives on a separate branch.
 *
 * @module lib/feedShareCard
 */

export interface ShareCardPost {
    author: string
    body: string
    hidden?: boolean
    deleted?: boolean
    replyCount?: number
}

export interface ShareCardModel {
    handle: string
    bodyText: string
    url: string
    replyLabel: string
    tomb: boolean
}

const TOMBSTONE_TEXT = "This post is no longer available on Memba."

function shortAddress(addr: string): string {
    return addr.length <= 13 ? addr : `${addr.slice(0, 6)}…${addr.slice(-5)}`
}

/** Build the text model. The tombstone guard lives here so no caller can paint a
 *  moderated body. Empty body is treated as unavailable too. */
export function buildShareCardModel(post: ShareCardPost, permalink: string): ShareCardModel {
    const tomb = Boolean(post.hidden) || Boolean(post.deleted) || post.body.trim() === ""
    const n = post.replyCount ?? 0
    return {
        handle: shortAddress(post.author),
        bodyText: tomb ? TOMBSTONE_TEXT : post.body.replace(/\s+/g, " ").trim(),
        url: permalink.replace(/^https?:\/\//, ""),
        replyLabel: n === 1 ? "1 reply" : `${n} replies`,
        tomb,
    }
}

// ── Riso Protest (light) palette — screenprint on warm paper ──────────────────
const PAPER = "#f4f1e9"
const INK = "#17140f"
const RISO_RED = "#ff4438"
const MUTED = "#6b6459"

// Canvas geometry — the summary_large_image standard (matches og:image intent).
const W = 1200
const H = 630
const PAD = 84
const BODY_MAX_LINES = 6

/** Greedy word-wrap using the ctx font metrics; clamps to maxLines with an
 *  ellipsis on the final line. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
    const words = text.split(" ")
    const lines: string[] = []
    let line = ""
    for (const w of words) {
        const trial = line ? `${line} ${w}` : w
        if (ctx.measureText(trial).width <= maxWidth || line === "") {
            line = trial
        } else {
            lines.push(line)
            line = w
            if (lines.length === maxLines - 1) break
        }
    }
    if (lines.length < maxLines) lines.push(line)
    // If we broke early there is more text → ellipsize the last line.
    const consumed = lines.join(" ").split(" ").length
    if (consumed < words.length) {
        let last = lines[lines.length - 1]
        while (last && ctx.measureText(last + "…").width > maxWidth) {
            last = last.slice(0, -1)
        }
        lines[lines.length - 1] = last.replace(/\s+$/, "") + "…"
    }
    return lines
}

/**
 * Paint the share card onto `ctx`. Deterministic, system-font (no webfont race),
 * brand-locked. Everything drawn is derived from the tombstone-safe model.
 */
export function drawFeedShareCard(ctx: CanvasRenderingContext2D, model: ShareCardModel): void {
    ctx.save()

    // Paper + a bold Riso-red rule down the left edge (the "protest" spot).
    ctx.fillStyle = PAPER
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = RISO_RED
    ctx.fillRect(0, 0, 16, H)

    const sans = `-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`

    // Masthead: MEMBA wordmark + a red dot.
    ctx.textBaseline = "alphabetic"
    ctx.textAlign = "left"
    ctx.fillStyle = INK
    ctx.font = `800 46px ${sans}`
    ctx.fillText("MEMBA", PAD, 108)
    // Measure the wordmark while its own font is active — measuring after the
    // font shrinks to 26px would place the handle too far left (overlap).
    const markW = ctx.measureText("MEMBA").width
    ctx.fillStyle = RISO_RED
    ctx.fillText("·", PAD + markW + 16, 108)
    ctx.fillStyle = MUTED
    ctx.font = `600 26px ${sans}`
    ctx.fillText(model.handle, PAD + markW + 46, 108)

    // Body — the post text (or the tombstone line), wrapped + clamped.
    ctx.fillStyle = INK
    ctx.font = `700 52px ${sans}`
    const lines = wrapLines(ctx, model.bodyText, W - PAD * 2, BODY_MAX_LINES)
    let y = 210
    for (const l of lines) {
        ctx.fillText(l, PAD, y)
        y += 70
    }

    // Footer rule + url + reply count.
    ctx.fillStyle = INK
    ctx.fillRect(PAD, H - 118, W - PAD * 2, 3)
    ctx.fillStyle = MUTED
    ctx.font = `600 28px ${sans}`
    ctx.fillText(model.url, PAD, H - 62)
    ctx.textAlign = "right"
    ctx.fillStyle = model.tomb ? MUTED : RISO_RED
    ctx.fillText(model.tomb ? "removed" : model.replyLabel, W - PAD, H - 62)

    ctx.restore()
}
