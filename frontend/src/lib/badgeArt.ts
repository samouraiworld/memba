/**
 * badgeArt.ts — programmatic SVG art for GnoBuilders badges.
 *
 * Generates simple, consistent badge SVGs with no asset files: a colored shield
 * per quest category (with the quest's emoji), and a colored medallion per rank
 * tier. Used by AchievementGrid for display and by scripts/gen-badge-assets.ts
 * to produce the images + metadata pinned to IPFS for the on-chain tokenURI
 * (see docs/BADGE_MINT_RUNBOOK.md).
 */

import { RANK_TIERS, type QuestCategory } from "./gnobuilders"

const CATEGORY_COLOR: Record<QuestCategory, string> = {
    developer: "#00d4aa",
    everyone: "#3b82f6",
    champion: "#f5a623",
    hidden: "#8b5cf6",
}

/** Escape the few characters that matter inside SVG text / attributes. */
function esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/** A shield badge in the category's color with the quest's emoji centered. */
export function questBadgeSvg(category: QuestCategory, icon: string): string {
    const color = CATEGORY_COLOR[category] ?? "#6b7280"
    const gid = `qg-${category}`
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="${esc(category)} quest badge">` +
        `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="${color}" stop-opacity="0.95"/>` +
        `<stop offset="1" stop-color="${color}" stop-opacity="0.55"/></linearGradient></defs>` +
        `<path d="M50 6 L86 20 V52 C86 74 68 88 50 94 C32 88 14 74 14 52 V20 Z" ` +
        `fill="url(#${gid})" stroke="${color}" stroke-width="2.5"/>` +
        `<text x="50" y="57" font-size="38" text-anchor="middle" dominant-baseline="middle">${esc(icon)}</text>` +
        `</svg>`
}

/** A circular medallion in the rank tier's color with the tier number. */
export function rankBadgeSvg(tier: number): string {
    const r = RANK_TIERS[tier] ?? RANK_TIERS[0]
    const gid = `rg-${r.tier}`
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="${esc(r.name)} rank badge">` +
        `<defs><radialGradient id="${gid}" cx="0.4" cy="0.35" r="0.85">` +
        `<stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/>` +
        `<stop offset="0.4" stop-color="${r.color}"/>` +
        `<stop offset="1" stop-color="${r.color}" stop-opacity="0.7"/></radialGradient></defs>` +
        `<circle cx="50" cy="50" r="42" fill="url(#${gid})" stroke="${r.color}" stroke-width="3"/>` +
        `<circle cx="50" cy="50" r="34" fill="none" stroke="#000000" stroke-opacity="0.18" stroke-width="1.5"/>` +
        `<text x="50" y="56" font-size="30" font-weight="700" text-anchor="middle" fill="#1a1a2e">${r.tier}</text>` +
        `</svg>`
}

/** Returns the rank tier if questId is a rank badge ("rank:N"), else null. */
export function rankTierOf(questId: string): number | null {
    if (!questId.startsWith("rank:")) return null
    const n = parseInt(questId.slice("rank:".length), 10)
    return Number.isFinite(n) ? n : null
}

/**
 * Wrap an SVG string as a data URI for an <img src>. Rendering via <img> (rather
 * than inlining the markup) sandboxes the SVG — no script execution — so it's
 * XSS-safe even though our generated markup is already controlled + escaped.
 */
export function svgDataUri(svg: string): string {
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
