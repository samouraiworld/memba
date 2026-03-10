/**
 * JitsiContext — Persistent Jitsi session state above route boundary.
 *
 * Lives in Layout.tsx, wrapping <Outlet>. The active Jitsi iframe
 * is rendered by JitsiPiPOverlay as a Layout sibling — never inside
 * route content — so it survives route changes.
 *
 * Design: single active session. Joining a new room replaces the old one.
 *
 * @module contexts/JitsiContext
 */

import { createContext, useContext, useState, useMemo, useCallback, useRef } from "react"
import { jitsiRoomName, jitsiIframeSrc } from "../components/ui/jitsiHelpers"

// ── Types ─────────────────────────────────────────────────────

export interface JitsiSession {
    daoSlug: string
    channelName: string
    mode: "voice" | "video"
    label: string
    roomName: string
    iframeSrc: string
}

export type JitsiDisplayMode = "expanded" | "pip"

export interface JoinRoomParams {
    daoSlug: string
    channelName: string
    mode: "voice" | "video"
    label: string
    description?: string
}

export interface JitsiContextValue {
    /** Active session (null = no room joined). */
    session: JitsiSession | null
    /** Display mode: "expanded" (full modal) or "pip" (mini-player). */
    displayMode: JitsiDisplayMode | null
    /** Join a room — creates session, shows expanded modal. */
    joinRoom: (params: JoinRoomParams) => void
    /** Leave the room — destroys session entirely. */
    leaveRoom: () => void
    /** Switch to PiP mini-player. */
    minimize: () => void
    /** Switch back to expanded modal. */
    expand: () => void
}

// ── Context ───────────────────────────────────────────────────

const JitsiContext = createContext<JitsiContextValue | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useJitsiContext(): JitsiContextValue {
    const ctx = useContext(JitsiContext)
    if (!ctx) throw new Error("useJitsiContext must be used within <JitsiProvider>")
    return ctx
}

// ── Provider ──────────────────────────────────────────────────

// Jitsi config params for iframe URL (shared with JitsiMeet.tsx)
const CONFIG_PARAMS = [
    "config.startWithAudioMuted=false",
    "config.prejoinPageEnabled=false",
    "config.disableDeepLinking=true",
    "config.disableProfile=true",
    "config.hideConferenceSubject=true",
    "interfaceConfig.SHOW_JITSI_WATERMARK=false",
    "interfaceConfig.SHOW_WATERMARK_FOR_GUESTS=false",
    "interfaceConfig.DISABLE_JOIN_LEAVE_NOTIFICATIONS=true",
].join("&")

export function JitsiProvider({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState<JitsiSession | null>(null)
    const [displayMode, setDisplayMode] = useState<JitsiDisplayMode | null>(null)
    const lastJoinRef = useRef(0)

    const joinRoom = useCallback((params: JoinRoomParams) => {
        // 1s cooldown to prevent rapid iframe reloads
        const now = Date.now()
        if (now - lastJoinRef.current < 1000) return
        lastJoinRef.current = now

        const roomName = jitsiRoomName(params.daoSlug, params.channelName)
        const videoConfig = params.mode === "voice"
            ? `config.startWithVideoMuted=true&${CONFIG_PARAMS}`
            : `config.startWithVideoMuted=false&${CONFIG_PARAMS}`
        const iframeSrc = jitsiIframeSrc(roomName, videoConfig)

        setSession({
            daoSlug: params.daoSlug,
            channelName: params.channelName,
            mode: params.mode,
            label: params.label,
            roomName,
            iframeSrc,
        })
        setDisplayMode("expanded")
    }, [])

    const leaveRoom = useCallback(() => {
        setSession(null)
        setDisplayMode(null)
    }, [])

    const minimize = useCallback(() => setDisplayMode("pip"), [])
    const expand = useCallback(() => setDisplayMode("expanded"), [])

    const value = useMemo<JitsiContextValue>(
        () => ({ session, displayMode, joinRoom, leaveRoom, minimize, expand }),
        [session, displayMode, joinRoom, leaveRoom, minimize, expand],
    )

    return <JitsiContext.Provider value={value}>{children}</JitsiContext.Provider>
}
