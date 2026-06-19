/**
 * gen-badge-assets.ts — generate badge SVGs + GRC721 metadata JSON for pinning.
 *
 *   npx tsx frontend/scripts/gen-badge-assets.ts <out-dir>
 *
 * Then pin <out-dir> to IPFS (one directory) and pass ipfs://<dir-CID> to
 * `badge-mint -metadata-base`. tokenURI = <base>/<questId>.json; each metadata's
 * "image" is a sibling SVG resolved within the same pinned directory.
 * See docs/BADGE_MINT_RUNBOOK.md.
 */

import { writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { ALL_QUESTS, RANK_TIERS, type QuestCategory } from "../src/lib/gnobuilders"
import { questBadgeSvg, rankBadgeSvg } from "../src/lib/badgeArt"

const outDir = process.argv[2] ?? "badge-assets"
mkdirSync(outDir, { recursive: true })

const CATEGORIES: QuestCategory[] = ["developer", "everyone", "champion", "hidden"]

// One SVG per category (quest badges share their category art) + per rank tier.
for (const cat of CATEGORIES) {
    writeFileSync(join(outDir, `quest-${cat}.svg`), questBadgeSvg(cat, "🏅"))
}
for (const r of RANK_TIERS) {
    if (r.tier === 0) continue
    writeFileSync(join(outDir, `rank-${r.tier}.svg`), rankBadgeSvg(r.tier))
}

// Per-quest metadata — image is a relative sibling SVG (resolved within the dir).
for (const q of ALL_QUESTS) {
    writeFileSync(join(outDir, `${q.id}.json`), JSON.stringify({
        name: q.title,
        description: q.description,
        image: `quest-${q.category}.svg`,
        attributes: [
            { trait_type: "Category", value: q.category },
            { trait_type: "Difficulty", value: q.difficulty },
            { trait_type: "XP", value: q.xp },
        ],
    }, null, 2))
}
// Per-rank metadata.
for (const r of RANK_TIERS) {
    if (r.tier === 0) continue
    writeFileSync(join(outDir, `rank-${r.tier}.json`), JSON.stringify({
        name: `${r.name} (Rank ${r.tier})`,
        description: `GnoBuilders rank badge — ${r.name}.`,
        image: `rank-${r.tier}.svg`,
        attributes: [
            { trait_type: "Rank", value: r.name },
            { trait_type: "Tier", value: r.tier },
        ],
    }, null, 2))
}

const ranks = RANK_TIERS.length - 1
console.log(`Wrote badge assets to ${outDir}/ — ${CATEGORIES.length} category SVGs, ${ranks} rank SVGs, ${ALL_QUESTS.length} quest + ${ranks} rank metadata.`)
