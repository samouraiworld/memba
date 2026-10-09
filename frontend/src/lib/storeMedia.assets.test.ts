import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { ECOSYSTEM_PROJECTS } from "./ecosystemDirectory"
import { GAME_REVIEW_SUBJECTS } from "./reviewSubjects"
import { resolveMedia, STORE_MEDIA } from "./storeMedia"

const PUBLIC = join(__dirname, "../../public")
const GAMES = Object.keys(GAME_REVIEW_SUBJECTS)
const APPS = ECOSYSTEM_PROJECTS.map((p) => p.id)

/** RIFF chunk ids of a WebP file; metadata lives in EXIF / XMP chunks. */
function webpChunks(file: Buffer): string[] {
    const ids: string[] = []
    for (let at = 12; at + 8 <= file.length;) {
        ids.push(file.toString("ascii", at, at + 4))
        const size = file.readUInt32LE(at + 4)
        at += 8 + size + (size % 2)
    }
    return ids
}

describe("storefront media", () => {
    // Gnogolf uses one requested homepage capture; other curated galleries keep their full contract.
    it.each([...GAMES, ...APPS.filter(key => key !== "gnogolf")])("%s has a logo, a cover, an accent and screenshots", (key) => {
        const media = STORE_MEDIA[key]
        expect(media, key).toBeDefined()
        expect(media.logo).toMatch(new RegExp(`^/store/${key}/logo\\.(svg|webp)$`))
        expect(media.cover).toBe(`/store/${key}/cover.webp`)
        expect(media.accent).toMatch(/^#[0-9A-Fa-f]{6}$/)
        expect(media.screenshots.length).toBeGreaterThanOrEqual(GAMES.includes(key) ? 4 : 3)
        expect(media.screenshots.length).toBeLessThanOrEqual(6)
        if (APPS.includes(key)) expect(media.sources.length, `${key} records where its assets came from`).toBeGreaterThan(0)
    })

    it("uses a local Gnogolf homepage capture with its official source recorded", () => {
        expect(STORE_MEDIA.gnogolf.sources).toEqual([{ url: "https://gnogolf.xyz/", retrieved: "2026-10-09" }])
        expect(resolveMedia("gnogolf", null, "gnogolf")).toEqual({ logo: null, cover: "/store/gnogolf/cover.jpg", screenshots: ["/store/gnogolf/shot-1.jpg"], accent: "#276749" })
    })

    it("every file exists, stays within its size budget, and carries no metadata", () => {
        for (const [key, media] of Object.entries(STORE_MEDIA)) {
            for (const path of [media.logo, media.cover, ...media.screenshots].filter((p): p is string => !!p)) {
                const file = join(PUBLIC, path)
                expect(existsSync(file), path).toBe(true)
                const budget = path.endsWith("cover.webp") ? 200_000 : path.includes("/shot-") ? 150_000 : 60_000
                expect(statSync(file).size, `${path} size`).toBeLessThanOrEqual(budget)
                const bytes = readFileSync(file)
                if (path.endsWith(".webp")) expect(webpChunks(bytes).filter((id) => id === "EXIF" || id === "XMP "), path).toEqual([])
                if (path.endsWith(".svg")) expect(bytes.toString("utf8"), path).not.toMatch(/<metadata|<!--/)
            }
            expect(key).toMatch(/^[a-z0-9-]+$/)
        }
    })
})
