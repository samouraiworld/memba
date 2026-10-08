import { entryAt, loadNow, loadStations, type NowPlaying, type RadioTrack, type Station } from "./client"

export interface RadioState { ready: boolean; station: number; stations: Station[]; track: RadioTrack | null; playing: boolean; busy: boolean; volume: number; error: string; status: string }
const initial = (): RadioState => ({ ready: false, station: 0, stations: [], track: null, playing: false, busy: false, volume: .65, error: "", status: "Choose Play to join the live station." })
/** An owner in the shell survives phone navigation and minimising a window. */
export class RadioPlayer {
    private state = initial()
    private listeners = new Set<() => void>()
    private audio: HTMLAudioElement | null = null
    private timer: ReturnType<typeof setInterval> | null = null
    private generation = 0
    private wanted = false
    private pending = false
    private nextRead = 0
    private loaded: NowPlaying | null = null
    private readAt = 0
    private urls: string[] = []
    private source = 0
    private seek = 0
    constructor(private api = { now: loadNow, stations: loadStations }, private makeAudio = () => new Audio(), private clock = () => performance.now()) {}
    subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
    snapshot = () => this.state
    private set(patch: Partial<RadioState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()) }
    start() {
        if (this.audio) return
        const audio = this.audio = this.makeAudio()
        this.set({ ready: true })
        audio.preload = "metadata"
        audio.volume = this.state.volume
        audio.onplaying = () => this.set({ playing: true, busy: false, status: "Live" })
        audio.onwaiting = () => { if (this.wanted) this.set({ busy: true, status: "Buffering…" }) }
        audio.onpause = () => this.set({ playing: false })
        audio.onloadedmetadata = () => {
            if (Number.isFinite(audio.duration)) audio.currentTime = Math.min(this.seek, Math.max(0, audio.duration - .2))
            if (this.wanted) void this.playAudio()
        }
        audio.onerror = () => {
            if (!this.wanted) return
            if (++this.source < this.urls.length) { audio.src = this.urls[this.source]; audio.load() }
            else { this.pause(); this.set({ error: "This track's audio is unavailable. Try again or choose another station." }) }
        }
        audio.onended = () => { if (this.wanted) void this.refresh() }
        this.timer = setInterval(() => {
            if (!this.wanted || !this.loaded || this.pending || this.clock() < this.nextRead) return
            const now = this.loaded.schedule.now + (this.clock() - this.readAt) / 1000
            const entry = entryAt(this.loaded.schedule, now)
            if (!entry || entry.track !== this.state.track?.id || this.clock() - this.readAt >= 30000) void this.refresh()
        }, 1000)
        void this.api.stations().then(stations => { if (this.audio === audio) this.set({ stations }) }).catch(() => { if (this.audio === audio) this.set({ error: "Could not load stations. Main is still available to try." }) })
    }
    private async playAudio() {
        const audio = this.audio
        const token = this.generation
        if (!audio || !this.wanted) return
        try { await audio.play() } catch {
            if (this.audio === audio && this.wanted && token === this.generation) { this.pause(); this.set({ error: "Playback was interrupted or blocked. Press Play to try again." }) }
        }
    }
    async refresh() {
        const token = ++this.generation
        const audio = this.audio
        if (!audio) return
        this.pending = true
        this.set({ busy: true, error: "", status: "Tuning in…" })
        const started = this.clock()
        try {
            const next = await this.api.now(this.state.station)
            if (token !== this.generation || this.audio !== audio) return
            // Add only time spent since this response arrived; the chain supplies the anchor.
            this.loaded = next
            this.nextRead = 0
            this.readAt = this.clock()
            const entry = entryAt(next.schedule, next.schedule.now)
            this.set({ track: next.track, busy: false })
            if (!entry || !next.track) { this.pause(); this.set({ status: "Nothing is on air on this station yet." }); return }
            if (!next.urls.length) { this.pause(); this.set({ error: "This track has no supported audio source." }); return }
            const offset = Math.max(0, next.schedule.now - entry.start + (this.clock() - started) / 2000)
            if (this.state.playing && audio.src && this.urls[0] === next.urls[0]) {
                if (Math.abs(audio.currentTime - offset) > 5) audio.currentTime = offset
                this.set({ status: "Live" })
                return
            }
            this.urls = next.urls; this.source = 0; this.seek = offset
            audio.pause(); audio.src = next.urls[0]; audio.load()
            if (this.wanted) await this.playAudio()
        } catch {
            if (token === this.generation && this.audio === audio) { this.nextRead = this.clock() + 10000; if (!this.state.playing) this.wanted = false; this.set({ busy: false, error: "Could not tune in to Gno Radio. Check your connection and try again.", status: this.state.playing ? "Playing; live schedule unavailable" : "Unavailable" }) }
        } finally { if (token === this.generation) this.pending = false }
    }
    toggle = () => {
        if (this.wanted) { this.pause(); return }
        this.wanted = true
        void this.refresh()
    }
    pause = () => { this.wanted = false; this.audio?.pause(); this.set({ playing: false, busy: false, status: "Paused" }) }
    station = (station: number) => {
        if (!this.state.stations.some(s => s.id === station)) return
        ++this.generation; this.pending = false; this.audio?.pause(); this.urls = []; this.loaded = null
        this.set({ station, track: null, playing: false })
        if (this.wanted) void this.refresh()
    }
    volume = (volume: number) => {
        const n = Math.max(0, Math.min(1, volume))
        if (!Number.isFinite(n)) return
        if (this.audio) this.audio.volume = n
        this.set({ volume: n })
    }
    dispose() {
        ++this.generation; this.wanted = false; this.pending = false
        if (this.timer) clearInterval(this.timer)
        if (this.audio) { const a = this.audio; a.onpause = a.onplaying = a.onwaiting = a.onloadedmetadata = a.onerror = a.onended = null; a.pause(); a.removeAttribute("src"); a.load() }
        this.audio = null; this.timer = null; this.loaded = null; this.urls = []; this.set(initial())
    }
}
export const radioPlayer = new RadioPlayer()
