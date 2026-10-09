import { z } from "zod"
import { assertRpcChain } from "../../../lib/dao/chainIdentity"
import { parseQevalGoJSON } from "../../../lib/goQuote"

export const RADIO_RPC = "https://rpc.onyx.testnets.gno.land:443"
export const RADIO_ROOT = "gno.land/r/nym-alexiscolin000/gnoradio"
const integer = z.number().int().nonnegative()
export const stationSchema = z.object({ id: integer, name: z.string().max(160) })
const onAirSchema = stationSchema.extend({ now: z.object({ track: integer, offset: integer }) })
export const scheduleSchema = z.object({ station: integer, now: integer, entries: z.array(z.object({ track: integer, start: integer, end: integer, offset: integer.optional() })).max(200) })
export const trackSchema = z.object({ id: integer, title: z.string().max(1000), artistName: z.string().max(1000), audio: z.string().max(4096), cover: z.string().max(4096), license: z.string().max(256), source: z.string().max(4096), attribution: z.string().max(4096), duration: integer.optional() })
export type Station = z.infer<typeof stationSchema>
export type Schedule = z.infer<typeof scheduleSchema>
export type RadioTrack = z.infer<typeof trackSchema>
export type NowPlaying = { schedule: Schedule; track: RadioTrack | null; urls: string[] }

export function safeLink(value: string): string {
    try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password ? u.href : "" } catch { return "" }
}
const MEDIA_HOSTS = ["archive.org", "ipfs.io", "dweb.link", "cloudflare-ipfs.com", "arweave.net", "audius.co", "audiuscontent.com", "jamendo.com"]
export function safeAudio(value: string): string {
    const link = safeLink(value)
    if (!link) return ""
    const u = new URL(link)
    return (!u.port || u.port === "443") && MEDIA_HOSTS.some(h => u.hostname === h || u.hostname.endsWith(`.${h}`)) ? link : ""
}
export function mediaSources(ref: string, stream = ""): string[] {
    if (/^ipfs:\/\/[A-Za-z0-9][A-Za-z0-9/_.%-]*$/.test(ref)) return ["https://ipfs.io/ipfs/", "https://dweb.link/ipfs/"].map(g => g + ref.slice(7))
    if (/^ar:\/\/[A-Za-z0-9_-]+$/.test(ref)) return [`https://arweave.net/${ref.slice(5)}`]
    if (/^audius:[A-Za-z0-9_-]+$/.test(ref)) return [`https://api.audius.co/v1/tracks/${encodeURIComponent(ref.slice(7))}/stream?app_name=Memba`]
    if (/^jamendo:\d+$/.test(ref)) {
        const link = safeAudio(stream)
        return link && new URL(link).hostname.endsWith(".jamendo.com") ? [link] : []
    }
    const link = safeAudio(ref)
    return link ? [link] : []
}
async function jsonFetch(url: string, init?: RequestInit): Promise<unknown> {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`Radio service answered ${res.status}.`)
    return res.json()
}
async function read<T>(realm: "radio" | "catalog", expr: string, schema: z.ZodType<T>): Promise<T> {
    // Radio has its own chain: never use Memba's selected-network failover.
    await assertRpcChain(RADIO_RPC, "onyx-1")
    const data = btoa(`${RADIO_ROOT}/${realm}/v1.${expr}`)
    const reply = z.object({ result: z.object({ response: z.object({ ResponseBase: z.object({ Error: z.unknown().optional(), Data: z.string().nullable() }) }) }) }).parse(await jsonFetch(RADIO_RPC, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "radio", method: "abci_query", params: { path: "vm/qeval", data } }),
    }))
    const base = reply.result.response.ResponseBase
    if (base.Error || !base.Data) throw new Error("Gno Radio is unavailable on Onyx.")
    const text = new TextDecoder().decode(Uint8Array.from(atob(base.Data), c => c.charCodeAt(0)))
    return schema.parse(parseQevalGoJSON(text))
}
export async function loadStations(): Promise<Station[]> {
    return (await read("radio", "StationsJSON()", z.object({ stations: z.array(stationSchema).max(64) }))).stations
}
export function entryAt(schedule: Schedule, now: number) {
    return schedule.entries.find(e => e.start <= now && now < e.end)
}
export async function loadNow(station: number): Promise<NowPlaying> {
    if (!Number.isSafeInteger(station) || station < 0) throw new Error("Invalid radio station.")
    let schedule = await read("radio", `ScheduleJSON(${station}, 600)`, scheduleSchema)
    if (schedule.station !== station) throw new Error("Radio returned another station.")
    const entry = entryAt(schedule, schedule.now)
    // Onyx v1 omits untitled Audius/Jamendo pointers from ScheduleJSON, even
    // while StationsJSON reports them on air. Match Gno Radio's live fallback.
    const onAir = entry ? undefined : (await read("radio", "StationsJSON()", z.object({ stations: z.array(onAirSchema).max(64) }))).stations.find(s => s.id === station)?.now
    if (!entry && !onAir) throw new Error("Radio did not return the requested station.")
    const trackId = entry?.track ?? onAir?.track
    if (!trackId) return { schedule, track: null, urls: [] }
    let track = await read("catalog", `TrackJSON(${trackId})`, trackSchema)
    if (track.id !== trackId) throw new Error("Radio returned another track.")
    if (!entry && onAir) {
        if (track.duration === undefined) throw new Error("Radio did not return the live track's duration.")
        if (track.duration <= onAir.offset) return { schedule, track: null, urls: [] }
        const start = schedule.now - onAir.offset
        const nextStart = Math.min(...schedule.entries.filter(e => e.start > schedule.now).map(e => e.start))
        schedule = { ...schedule, entries: [{ track: trackId, start, end: Math.min(start + track.duration, nextStart), offset: onAir.offset }, ...schedule.entries] }
    }
    let stream = ""
    if (/^(audius:|jamendo:)/.test(track.audio)) {
        const meta = z.record(z.string(), z.object({ title: z.string(), artist: z.string(), artwork: z.string().optional(), permalink: z.string().optional(), stream: z.string().optional(), streamable: z.boolean() }).nullable())
            .parse(await jsonFetch(`/api/radio-meta?bucket=${Math.floor(track.id / 100)}`))[track.audio]
        if (!meta?.streamable) throw new Error("This track is unavailable from its music provider.")
        stream = meta.stream ?? ""
        track = { ...track, title: meta.title, artistName: meta.artist, cover: meta.artwork ?? track.cover, source: meta.permalink ?? track.source }
    }
    return { schedule, track, urls: mediaSources(track.audio, stream) }
}
