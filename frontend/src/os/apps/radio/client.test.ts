import { afterEach, describe, expect, it, vi } from "vitest"
import { entryAt, loadNow, RADIO_ROOT, RADIO_RPC } from "./client"
import { assertRpcChain } from "../../../lib/dao/chainIdentity"

vi.mock("../../../lib/dao/chainIdentity", () => ({ assertRpcChain: vi.fn(async () => {}) }))

const track = (audio = "jamendo:78047") => ({ id: 3931, title: "", artistName: "", duration: 284, audio, cover: "", source: "", license: "CC-BY-NC-SA-3.0", attribution: "" })
const schedule = { station: 0, now: 1791543191, entries: [] }
const stations = { stations: [{ id: 1, name: "Electronica", now: { track: 4741, offset: 196 } }, { id: 0, name: "Main", now: { track: 3931, offset: 22 } }] }
const metadata = (audio: string) => ({ [audio]: { title: "On air", artist: "Artist", streamable: true, stream: "https://prod-1.storage.jamendo.com/audio.mp3" } })
function rpc(value: unknown) {
    return { result: { response: { ResponseBase: { Error: null, Data: btoa(`(${JSON.stringify(JSON.stringify(value))} string)`) } } } }
}
function fixture(values: Record<string, unknown>) {
    const queries: string[] = []
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
        const expr = init?.body ? atob(JSON.parse(String(init.body)).params.data) : url
        queries.push(expr)
        if (!(expr in values)) throw new Error(`Unexpected query: ${expr}`)
        const value = values[expr]
        if (value instanceof Error) throw value
        return { ok: true, json: async () => init?.body ? rpc(value) : value }
    })
    vi.stubGlobal("fetch", fetcher)
    return queries
}
const scheduled = `${RADIO_ROOT}/radio/v1.ScheduleJSON(0, 600)`
const onAir = `${RADIO_ROOT}/radio/v1.StationsJSON()`
const catalog = `${RADIO_ROOT}/catalog/v1.TrackJSON(3931)`
const meta = "/api/radio-meta?bucket=39"
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe("live radio reads", () => {
    for (const audio of ["jamendo:78047", "audius:abc123"]) {
        it(`loads the on-air ${audio.split(":")[0]} pointer omitted by the v1 schedule`, async () => {
            const queries = fixture({ [scheduled]: schedule, [onAir]: stations, [catalog]: track(audio), [meta]: metadata(audio) })
            const result = await loadNow(0)
            expect(result.track).toMatchObject({ id: 3931, title: "On air", artistName: "Artist" })
            expect(entryAt(result.schedule, schedule.now)).toMatchObject({ track: 3931, start: schedule.now - 22, end: schedule.now + 262 })
            expect(result.urls[0]).toContain(audio.startsWith("jamendo") ? "jamendo.com" : "api.audius.co")
            expect(queries).toEqual([scheduled, onAir, catalog, meta])
            expect(assertRpcChain).toHaveBeenCalledWith(RADIO_RPC, "onyx-1")
        })
    }
    it("keeps a scheduled entry authoritative without reading the fallback", async () => {
        const entry = { track: 3931, start: schedule.now - 22, end: schedule.now + 262, offset: 22 }
        const queries = fixture({ [scheduled]: { ...schedule, entries: [entry] }, [catalog]: track("https://archive.org/song.mp3") })
        expect((await loadNow(0)).schedule.entries).toEqual([entry])
        expect(queries).toEqual([scheduled, catalog])
    })
    it("ends the fallback at the next scheduled track so it cannot overrun a queued pick", async () => {
        const next = { track: 99, start: schedule.now + 10, end: schedule.now + 100 }
        fixture({ [scheduled]: { ...schedule, entries: [next] }, [onAir]: stations, [catalog]: track("https://archive.org/song.mp3") })
        const result = await loadNow(0)
        expect(entryAt(result.schedule, schedule.now + 9)?.track).toBe(3931)
        expect(entryAt(result.schedule, schedule.now + 10)?.track).toBe(99)
    })
    it("reports silence only when the station also reports no current track", async () => {
        const queries = fixture({ [scheduled]: schedule, [onAir]: { stations: [{ id: 0, name: "Main", now: { track: 0, offset: 0 } }] } })
        expect(await loadNow(0)).toEqual({ schedule, track: null, urls: [] })
        expect(queries).toEqual([scheduled, onAir])
    })
    it("does not replay an on-air snapshot whose track has ended", async () => {
        fixture({ [scheduled]: schedule, [onAir]: stations, [catalog]: { ...track(), duration: 22 } })
        expect((await loadNow(0)).track).toBeNull()
    })
    it("surfaces a failed fallback read instead of saying that the station is silent", async () => {
        fixture({ [scheduled]: schedule, [onAir]: new Error("offline") })
        await expect(loadNow(0)).rejects.toThrow("offline")
    })
    it("does not mistake an omitted station for confirmed silence", async () => {
        fixture({ [scheduled]: schedule, [onAir]: { stations: [stations.stations[0]] } })
        await expect(loadNow(0)).rejects.toThrow("requested station")
    })
    it("rejects a mismatched track in the fallback", async () => {
        fixture({ [scheduled]: schedule, [onAir]: stations, [catalog]: { ...track(), id: 4741 } })
        await expect(loadNow(0)).rejects.toThrow("another track")
    })
    it("requires a duration to bound fallback playback", async () => {
        fixture({ [scheduled]: schedule, [onAir]: stations, [catalog]: { ...track(), duration: undefined } })
        await expect(loadNow(0)).rejects.toThrow("duration")
    })
})
