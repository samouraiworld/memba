import { afterEach, describe, expect, it, vi } from "vitest"
import { RadioPlayer } from "./player"
import { entryAt, mediaSources, safeAudio, scheduleSchema, type NowPlaying } from "./client"

const result = (id = 1): NowPlaying => ({ schedule: { station: 0, now: 100, entries: [{ track: id, start: 80, end: 140 }] }, track: { id, title: "A song", artistName: "Artist", audio: "https://archive.org/song.mp3", cover: "", source: "", license: "CC BY", attribution: "Artist — CC BY" }, urls: [`https://archive.org/${id}.mp3`] })
function fixture(now = vi.fn(async () => result())) {
    const audio = { src: "", volume: 0, currentTime: 0, duration: 300, preload: "", onplaying: null, onpause: null, onwaiting: null, onloadedmetadata: null, onerror: null, onended: null, play: vi.fn(async () => {}), pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn() }
    const api = { now, stations: vi.fn(async () => [{ id: 0, name: "Main" }, { id: 1, name: "Ambient" }]) }
    const player = new RadioPlayer(api, () => audio as unknown as HTMLAudioElement, () => 0)
    player.start()
    return { audio, api, player }
}
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)) }
const players: RadioPlayer[] = []
afterEach(() => { players.forEach(p => p.dispose()); players.length = 0 })
describe("radio lifetime and schedule", () => {
    it("never starts audio when the widget opens; explicit Play joins the live offset", async () => {
        const { audio, player } = fixture(); players.push(player)
        expect(audio.play).not.toHaveBeenCalled()
        player.toggle(); await settle()
        audio.onloadedmetadata?.()
        expect(audio.currentTime).toBe(20)
        expect(audio.play).toHaveBeenCalled()
    })
    it("does not double-count the realm's current offset for a track already on air", async () => {
        const next = result()
        next.schedule.now = 1000
        next.schedule.entries[0].start = 863
        next.schedule.entries[0].end = 1060
        next.schedule.entries[0].offset = 137
        expect(scheduleSchema.parse(next.schedule).entries[0].offset).toBe(137)
        const { audio, player } = fixture(vi.fn(async () => next)); players.push(player)
        player.toggle(); await settle(); audio.onloadedmetadata?.()
        expect(audio.currentTime).toBe(137)
    })
    it("does not autoplay after Pause while metadata is pending", async () => {
        let finish!: (v: NowPlaying) => void
        const { audio, player } = fixture(vi.fn(() => new Promise<NowPlaying>(r => { finish = r }))); players.push(player)
        player.toggle(); player.pause(); finish(result()); await settle()
        audio.onloadedmetadata?.()
        expect(audio.play).not.toHaveBeenCalled()
        expect(player.snapshot().playing).toBe(false)
    })
    it("discards a response from the old station", async () => {
        const pending: ((v: NowPlaying) => void)[] = []
        const { player } = fixture(vi.fn(() => new Promise<NowPlaying>(r => { pending.push(r) }))); players.push(player)
        await settle(); player.toggle(); player.station(1)
        pending[1]({ ...result(2), schedule: { ...result(2).schedule, station: 1 } }); await settle()
        pending[0](result(1)); await settle()
        expect(player.snapshot().track?.id).toBe(2)
    })
    it("closing stops playback and invalidates pending work", async () => {
        let finish!: (v: NowPlaying) => void
        const { audio, player } = fixture(vi.fn(() => new Promise<NowPlaying>(r => { finish = r }))); players.push(player)
        player.toggle(); player.dispose(); finish(result()); await settle()
        expect(audio.pause).toHaveBeenCalled()
        expect(audio.removeAttribute).toHaveBeenCalledWith("src")
        expect(audio.play).not.toHaveBeenCalled()
    })
    it("allows another Play immediately after a failed read", async () => {
        const { api, player } = fixture(vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(result())); players.push(player)
        player.toggle(); await settle(); player.toggle(); await settle()
        expect(api.now).toHaveBeenCalledTimes(2)
    })
    it("selects the next entry at the exact boundary", () => {
        const schedule = { station: 0, now: 0, entries: [{ track: 1, start: 80, end: 100 }, { track: 2, start: 100, end: 120 }] }
        expect(entryAt(schedule, 100)?.track).toBe(2)
        expect(entryAt(schedule, 120)).toBeUndefined()
    })
    it("rejects foreign, credentialed and unsafe media references", () => {
        for (const ref of ["javascript:alert(1)", "http://archive.org/a", "https://archive.org.evil.test/a", "https://u:p@archive.org/a", "https://evil.test/a"]) expect(safeAudio(ref)).toBe("")
        expect(mediaSources("jamendo:42", "https://evil.test/a")).toEqual([])
        expect(mediaSources("jamendo:42", "https://prod-1.storage.jamendo.com/audio")).toHaveLength(1)
        expect(mediaSources("ipfs://bafy123/audio.mp3")).toHaveLength(2)
    })
})
