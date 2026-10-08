/** Deterministic Web Locks test double with shared/exclusive ordering. */
export function installTestLocks() {
    const states = new Map<string, { readers: number; writer: boolean; queue: (() => void)[] }>()
    Object.defineProperty(navigator, "locks", { configurable: true, value: {
        request: <T,>(name: string, options: { mode?: string }, run: () => Promise<T>) => new Promise<T>((resolve, reject) => {
            const state = states.get(name) ?? { readers: 0, writer: false, queue: [] }
            states.set(name, state)
            const shared = options.mode === "shared"
            const pump = () => { state.queue[0]?.() }
            const grant = () => {
                if (state.writer || (!shared && state.readers)) return
                state.queue.shift()
                if (shared) state.readers++
                else state.writer = true
                void Promise.resolve().then(run).then(resolve, reject).finally(() => {
                    if (shared) state.readers--
                    else state.writer = false
                    pump()
                })
                if (shared) pump()
            }
            state.queue.push(grant)
            pump()
        }),
    } })
}
