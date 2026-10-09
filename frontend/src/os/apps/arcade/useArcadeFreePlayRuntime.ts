import { useLayoutEffect, useRef, useState } from "react"
import { createFreePlayClient, type FreePlayClient } from "../../../lib/arcadeFreePlay"
import { createOsFreePlayAuth, type FreePlayOsSession } from "../../../games/arcade/freeplay/osAuth"
import type { FreePlayRuntime } from "../../../games/arcade/freeplay/FreePlayRuntimeContext"
import type { SnapshotStorage } from "../../../games/arcade/freeplay/snapshot"
import type { OsSession } from "../../shell/useOsSession"

import { validateArcadeFreePlayConfiguration, type ArcadeFreePlayConfiguration } from "../../../games/arcade/freeplay/runtimeConfiguration"
export type { ArcadeFreePlayConfiguration } from "../../../games/arcade/freeplay/runtimeConfiguration"

interface Options { session: OsSession; locked: boolean; onEvm: boolean; configuration: ArcadeFreePlayConfiguration | null }
interface Committed { enabled: boolean; session: FreePlayOsSession; connect(): void }
interface Owner { configuration: ArcadeFreePlayConfiguration; scope: string; generation: number; value: FreePlayRuntime; refresh(): void; dispose(): void }
const games = ["block-party", "space-invaders", "barricade"] as const

function construct(configuration: ArcadeFreePlayConfiguration, scope: string, generation: number, read: () => Committed): Owner {
    validateArcadeFreePlayConfiguration(configuration)
    let active = true
    const auth = createOsFreePlayAuth({ readSession: () => read().session })
    const listeners = new Set<() => void>()
    const notify = () => { for (const listener of [...listeners]) { try { listener() } catch { /* observers do not turn a persisted write into failure */ } } }
    const storage: SnapshotStorage = {
        getItem: key => configuration.storage.getItem(key),
        setItem: (key, value) => { configuration.storage.setItem(key, value); notify() },
    }
    try {
        const clients = new Map<string, FreePlayClient>()
        const value: FreePlayRuntime = {
            games: {},
            subscribeSavedRuns: listener => { if (!active) return () => {}; listeners.add(listener); return () => { listeners.delete(listener) } },
        }
        for (const game of games) {
            const configured = configuration.games[game]
            if (!configured) continue
            const { rules, simVersion, remote } = configured
            let client: FreePlayClient | undefined
            if (remote) {
                if (remote.target.chainId !== configuration.chainId) throw new Error("free_play_target_mismatch")
                const key = JSON.stringify([remote.origin, remote.target.chainId, remote.target.realm])
                client = clients.get(key)
                if (!client) {
                    client = createFreePlayClient({ ...remote, auth, fetch: (...args) => fetch(...args) })
                    clients.set(key, client)
                }
            }
            value.games[game] = { rules, simVersion, storage, client, target: remote?.target, connect: () => { if (active && read().enabled) read().connect() } }
        }
        window.addEventListener("storage", notify)
        return { configuration, scope, generation, value, refresh: auth.refreshIdentity, dispose() {
            if (!active) return
            active = false
            window.removeEventListener("storage", notify)
            listeners.clear()
            auth.dispose()
        } }
    } catch (error) { auth.dispose(); throw error }
}

/** One owner for the workspace. Null configuration leaves all existing paths dormant. */
export function useArcadeFreePlayRuntime({ session, locked, onEvm, configuration }: Options): FreePlayRuntime | null {
    const blocked = locked || onEvm
    const snapshot: Committed = {
        enabled: !blocked,
        session: { status: blocked ? "guest" : session.status, token: blocked ? null : (session.layout?.auth?.token ?? null),
            address: session.address, walletAddress: session.walletAddress, walletChainId: session.walletChainId, chainId: session.network.chainId },
        connect: session.openConnect,
    }
    const committed = useRef(snapshot)
    const alive = useRef<Owner | null>(null)
    const [owner, setOwner] = useState<Owner | null>(null)
    const scope = JSON.stringify([session.network.chainId, session.status, session.address, session.walletAddress, session.walletChainId])
    const [context, setContext] = useState({ configuration, scope, blocked, generation: 0 })
    if (context.configuration !== configuration || context.scope !== scope || context.blocked !== blocked) {
        setContext({ configuration, scope, blocked, generation: context.generation + 1 })
    }
    const generation = context.generation
    useLayoutEffect(() => {
        committed.current = snapshot
        alive.current?.refresh()
    })
    useLayoutEffect(() => {
        if (blocked || !configuration || configuration.chainId !== committed.current.session.chainId) return
        let next: Owner
        try { next = construct(configuration, scope, generation, () => committed.current) }
        catch { return } // Invalid injected configuration fails closed; no fallback endpoint.
        alive.current = next
        // External subscriptions are constructed after commit, never during render.
        setOwner(next)
        return () => { next.dispose(); if (alive.current === next) alive.current = null }
    }, [configuration, scope, blocked, generation])
    // Hide a replaced owner during render, before passive effects or callbacks.
    return !blocked && configuration && owner?.configuration === configuration && owner.scope === scope && owner.generation === generation
        ? owner.value : null
}
