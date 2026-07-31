import { expect, type Page } from '@playwright/test'

/**
 * Mobile-overflow assertion for the 375px specs.
 *
 * WHY THIS EXISTS — the `document.body.scrollWidth <= 380` check these specs used
 * to carry could not fail. Two independent reasons, both measured 2026-07-31:
 *
 *  1. The threshold sat ABOVE the viewport (380 > 375), so any unrendered state
 *     satisfied it. Every one of these specs read scrollWidth immediately after
 *     goto(), while the page still held only the ~304-char layout shell (topbar +
 *     tabbar) and none of the route's own content — which settles later at
 *     415–3930 chars. They measured an empty shell against a threshold nothing
 *     could exceed.
 *
 *  2. More fundamentally, scrollWidth CANNOT report content overflow in this app.
 *     index.css sets `body { overflow-x: hidden; max-width: 100vw }`, and per CSS
 *     overflow propagation that clip moves to the VIEWPORT (computed
 *     documentElement overflow-x is `hidden`). Injecting a 900px-wide div into
 *     <main> leaves BOTH document.body.scrollWidth AND
 *     document.documentElement.scrollWidth pinned at 375. Only a direct child of
 *     <body> — which no route content is — can move body.scrollWidth at all.
 *     A content wait alone would therefore have produced a still-vacuous test.
 *
 * WHAT WE ASSERT INSTEAD — because the app clips rather than scrolls, a real
 * mobile regression here does not show up as a sideways-scrolling page. It shows
 * up as content CLIPPED AWAY: a box that hides part of its own content. So we
 * look for any element whose computed overflow-x is `hidden`/`clip` and whose
 * scrollWidth exceeds its clientWidth.
 *
 * `auto`/`scroll` are deliberately EXCLUDED: that content is still reachable by
 * the user. The GovDAO channel rail (`.dao-channels-sidebar`, index.css:617 —
 * `flex-wrap: nowrap; overflow-x: auto`) is an intentional swipeable strip whose
 * children extend to ~1141px at a 375px viewport. Flagging it would be a false
 * positive; excluding `auto`/`scroll` is what keeps it out.
 *
 * Verified falsifiable: clean == 0 offenders on all nine routes; a 900px div
 * appended to each route's real content container is caught on every one, naming
 * the box that clips it (`.k-main-column sw=910 cw=375`, `.k-card sw=924 cw=353`, …).
 */

/** The viewport these specs standardize on. */
export const MOBILE_375 = { width: 375, height: 667 }

/**
 * Every element that is hiding content horizontally, as `TAG.class sw=… cw=…`.
 * Empty array == nothing clipped. Returned rather than asserted so callers can
 * attach their own message.
 */
export async function findHorizontalClipping(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const out: string[] = []
        // body included: it is the one box a direct-child overflow can move.
        const els: Element[] = [document.body, ...Array.from(document.querySelectorAll('body *'))]
        for (const el of els) {
            const cs = getComputedStyle(el)
            if (cs.display === 'none' || cs.visibility === 'hidden') continue
            const ox = cs.overflowX
            // Only clipping boxes lose content; auto/scroll stays reachable.
            if (ox !== 'hidden' && ox !== 'clip') continue
            // Deliberate single-line truncation: the element declares its own
            // ellipsis, so scrollWidth > clientWidth is the DESIGN, not a defect
            // (e.g. .k-dao-card__desc — nowrap + text-overflow: ellipsis, which
            // legitimately reported sw=425 cw=305 on the DAO hub).
            if (cs.textOverflow === 'ellipsis') continue
            // +1 absorbs sub-pixel rounding on fractional layouts.
            if (el.scrollWidth > el.clientWidth + 1) {
                const cls = (el.className || '').toString().trim().split(/\s+/).slice(0, 2).join('.')
                out.push(`${el.tagName}${cls ? '.' + cls : ''} sw=${el.scrollWidth} cw=${el.clientWidth}`)
            }
        }
        return out
    })
}

/**
 * Assert the page hides no content horizontally at 375px.
 *
 * Call AFTER waiting for the route's own content — this measures the live DOM,
 * so against an unrendered shell it passes without proving anything.
 */
export async function expectNoMobileOverflow(page: Page): Promise<void> {
    const clipped = await findHorizontalClipping(page)
    expect(clipped, 'element(s) clipping content horizontally at 375px').toEqual([])

    // Root-clip safety net, tightened from 380 to the exact viewport width: every
    // route measures exactly 375 once rendered. This is the guard treasury.spec
    // describes — it fails if a change removes `body { overflow-x: hidden }` and
    // a wide child starts pushing the page itself wide.
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
    expect(bodyWidth, 'page must not exceed the 375px viewport').toBeLessThanOrEqual(375)
}
