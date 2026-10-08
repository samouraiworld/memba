/** The Arcade's own games: page copy, review subjects and routes. Copy comes from each game's existing page. */
import { isBarricadeEnabled, isConnect4Live, isGameEnabled, isSpaceInvadersEnabled } from "../../../lib/config"
import { GAME_REVIEW_SUBJECTS, type ArcadeGameId } from "../../../lib/reviewSubjects"

export interface ArcadeGame {
    id: ArcadeGameId
    name: string
    /** The existing game route under /os/arcade. */
    section: "game" | "space-invaders" | "barricade" | "connect4"
    pitch: string
    description: string
    howTo: readonly string[]
    tags: readonly string[]
    cost: "free" | "staked"
    info: readonly (readonly [string, string])[]
    /** Null until the game has an audited mainnet realm: it then has no ratings and no reviews. */
    reviewSubject: string | null
    enabled: () => boolean
    daily: boolean
    dailyBoard: boolean
    featured: boolean
}

const MADE_BY: readonly [string, string] = ["Made by", "Samourai Coop"]

export const ARCADE_GAMES: readonly ArcadeGame[] = [
    {
        id: "block-party", name: "Block Party", section: "game", pitch: "A chain-seeded daily block puzzle",
        description: "Slide every tile at once and merge equal numbers. Daily: everyone gets the same board and the same number of moves; sign in and your first finished run of the day is checked and posted. Practice: a random board, no move limit, and undo. Nothing is posted.",
        howTo: ["Swipe, or press the arrow keys, to slide every tile at once.", "Two tiles with the same number merge into one, and its value is added to your score.", "A new tile appears after every move. The game ends when nothing can move or your moves run out."],
        tags: ["Puzzle", "Daily"], cost: "free",
        info: [["Modes", "Daily · Practice"], ["Players", "Solo"], ["Cost", "Free"], ["Scores", "First finished Daily run, checked and posted"], ["Controls", "Swipe or arrow keys"], MADE_BY],
        reviewSubject: GAME_REVIEW_SUBJECTS["block-party"] ?? null, enabled: isGameEnabled, daily: true, dailyBoard: true, featured: true,
    },
    {
        id: "space-invaders", name: "Space Invaders", section: "space-invaders", pitch: "Daily arcade waves and free play",
        description: "Signal Defense — hold the relay, clear the swarm, keep the network online. Chain clean hits to amplify your signal; every miss breaks the multiplier. One shared signal for the day.",
        howTo: ["Move, fire or press Enter to begin.", "On touch, drag left to steer and tap right to fire.", "Chain hits without missing to raise your multiplier."],
        tags: ["Shooter", "Daily"], cost: "free",
        info: [["Modes", "Daily · Free play"], ["Players", "Solo"], ["Cost", "Free"], ["Scores", "Daily run replay-checked on this device"], ["Controls", "Keyboard · touch"], MADE_BY],
        reviewSubject: GAME_REVIEW_SUBJECTS["space-invaders"] ?? null, enabled: isSpaceInvadersEnabled, daily: true, dailyBoard: false, featured: true,
    },
    {
        id: "barricade", name: "BARRICADE", section: "barricade", pitch: "Defend the lanes in a daily run",
        description: "Hold the Paris barricade against the machines in a daily run. An accepted run waits for day-close attestation; it is not on-chain yet.",
        howTo: ["Tap a lane and you fire automatically; shove its nearest machine or aim a molotov farther up the street.", "Defeated machines fill Rally and drop scrap for the between-wave shop.", "Everyone gets the same daily seed; Practice uses a separate run."],
        tags: ["Strategy", "Daily"], cost: "free",
        info: [["Modes", "Daily run"], ["Players", "Solo"], ["Cost", "Free"], ["Scores", "Accepted runs await day-close attestation"], MADE_BY],
        reviewSubject: GAME_REVIEW_SUBJECTS.barricade ?? null, enabled: isBarricadeEnabled, daily: true, dailyBoard: false, featured: true,
    },
    {
        id: "connect4", name: "Connect 4", section: "connect4", pitch: "Staked two-player — winner takes the pot",
        description: "Post an offer or accept one. Both players stake the same GNOT; the winner takes the pot minus a house fee. Each move has 90 seconds of chain time — run out and you forfeit. If no one moves at all, both stakes are refunded.",
        howTo: ["Connect your wallet to play. You can watch games without one.", "After someone accepts, you must reveal within 90 seconds — keep this tab open until the game starts.", "The reveal key is stored only in this browser; missing it forfeits your stake."],
        tags: ["Duel", "Staked"], cost: "staked",
        info: [["Modes", "Staked duel"], ["Players", "2"], ["Cost", "Staked · GNOT"], ["Scores", "Results settle on-chain"], ["Controls", "Pick a column"], MADE_BY],
        reviewSubject: null, enabled: isConnect4Live, daily: false, dailyBoard: false, featured: false,
    },
]

export function gameById(id: string): ArcadeGame | undefined {
    return ARCADE_GAMES.find((game) => game.id === id)
}

export function gameSection(game: Pick<ArcadeGame, "id">): string {
    return `g/${game.id}`
}
