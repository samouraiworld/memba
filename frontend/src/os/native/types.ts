/**
 * The props a native app window receives from WindowFrame's Body: the same
 * session and actions every window gets, plus `fallback`: exactly what the
 * window would show without a native view (the classic page, or the Connect
 * tile when that page needs a wallet and there's no member session, or a
 * holding tile). Render it for the sections the native view doesn't handle
 * yet; never rebuild the classic page yourself, or the wallet gate is lost.
 *
 * @module os/native/types
 */
import type { ReactNode } from "react"
import type { OsAppId } from "../apps"
import type { OsSession } from "../shell/useOsSession"
import type { WindowSpec } from "../shell/windows"

// Deliberately mirrors WindowFrame's (unexported) Actions member types rather than
// importing it, since WindowFrame imports this module — importing Actions back would
// be circular. Keep the two in sync by hand when either changes.
export interface NativeViewProps {
    section: string | null
    query?: string
    session: OsSession
    open: (spec: WindowSpec) => void
    openApp: (app: OsAppId) => void
    close: () => void
    toast: (msg: string) => void
    fallback: ReactNode
}
