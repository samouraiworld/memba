import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import type { NativeViewProps } from "../../native/types"

type Entry = { container: HTMLDivElement | null; slot: HTMLDivElement | null }
function createRegistry() {
    const entries = new Map<string, Entry>()
    function register(key: string, part: keyof Entry, element: HTMLDivElement) {
        const entry = entries.get(key) ?? { container: null, slot: null }
        entries.set(key, entry)
        entry[part] = element
        if (entry.container && entry.slot) entry.slot.appendChild(entry.container)
        return () => {
            // Old slot cleanup may follow attachment of its replacement.
            if (entry[part] !== element) return
            if (part === "container") element.remove()
            else if (entry.container?.parentNode === element) entry.container.remove()
            entry[part] = null
            if (!entry.container && !entry.slot) entries.delete(key)
        }
    }
    return { register }
}

const RegistryContext = createContext<ReturnType<typeof createRegistry> | null>(null)

/** Holds only DOM references. The public reader and comment session belong to the keyed stage. */
export function NotesStageProvider({ children }: { children: ReactNode }) {
    const [registry] = useState(createRegistry)
    return <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>
}

// The slot and stable stage must share this one private context instance.
// eslint-disable-next-line react-refresh/only-export-components
export function useNotesStageRegistry() { return useContext(RegistryContext) }

// eslint-disable-next-line react-refresh/only-export-components
export function notesStageKey({ session, section }: Pick<NativeViewProps, "session" | "section">): string {
    return JSON.stringify([session.network.chainId, session.address || "guest", section])
}

/** Window chrome owns this replaceable slot; the public reader remains mounted elsewhere. */
export function NotesSlot(props: NativeViewProps) {
    const registry = useNotesStageRegistry()
    const key = notesStageKey(props)
    const slot = useRef<HTMLDivElement>(null)
    useLayoutEffect(() => {
        if (registry && slot.current) return registry.register(key, "slot", slot.current)
    }, [registry, key])
    return registry ? <div ref={slot} className="os-notes-slot" style={{ height: "100%", minHeight: 0 }} /> : props.fallback
}
