/**
 * Daily ambience plates — near-free content variety (GDD-v2 §5): the night's
 * MOOD shifts with the seed while every color that MEANS something stays
 * fixed. Identity and threat coding (ink, paper, vermilion rebel, cold machine
 * steels, teal rally, gold scrap) are deliberately NOT part of a plate: a
 * player must never have to relearn what a color means because the date
 * changed. Pure module — no sim import, no DOM, deterministic per seed.
 */

export type Plate = {
    name: string
    stockAlt: string // the alternating lane tint
    horizon: string // the sky band behind the skyline
    windowGlow: string // lit windows in the city
}

export const PLATES: Plate[] = [
    { name: "curfew-violet", stockAlt: "#191333", horizon: "#0f0c1e", windowGlow: "#dba43c" }, // the original night
    { name: "teargas-dawn", stockAlt: "#1b1530", horizon: "#1a1024", windowGlow: "#e0928a" },
    { name: "blackout", stockAlt: "#161228", horizon: "#0a0814", windowGlow: "#8fa8e0" },
    { name: "sodium-haze", stockAlt: "#1c1630", horizon: "#171022", windowGlow: "#e8b54e" },
    { name: "cold-front", stockAlt: "#151833", horizon: "#0c1020", windowGlow: "#9fd4d0" },
]

/** FNV-1a over the seed picks tonight's plate — same derivation family as the sim's rng seeding. */
export function paletteFor(seed: string): Plate {
    let h = 0x811c9dc5
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i)
        h = Math.imul(h, 0x01000193) >>> 0
    }
    return PLATES[h % PLATES.length]
}
