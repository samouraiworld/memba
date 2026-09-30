/**
 * The props a native app window receives from WindowFrame's Body: the session
 * and actions every window gets, whether its window is in front, a way to go
 * somewhere as a history entry, and `fallback`: exactly what the window would
 * show without a native view (the classic page, or the Connect tile when that
 * page needs a wallet and there's no member session, or a holding tile).
 * Render it for the sections the native view doesn't handle yet; never rebuild
 * the classic page yourself, or the wallet gate is lost.
 *
 * @module os/native/types
 */
import type { ReactNode } from "react"
import type { OsAppId } from "../apps"
import type { OsSession } from "../shell/useOsSession"
import type { WindowSpec } from "../shell/windows"

// `open`, `openApp`, `close` and `toast` mirror WindowFrame's (unexported) Actions member
// types rather than importing them, since WindowFrame imports this module — importing
// Actions back would be circular. Keep them in sync by hand. `active` and `push` are made
// by WindowFrame's Body for the native view.
export interface NativeViewProps {
    section: string | null
    query?: string
    session: OsSession
    /** True while this window is the front one: a view that polls or animates can rest when it is not. */
    active: boolean
    /** Opens the target's window, or shows the target in this one, without a history entry of its own. */
    open: (spec: WindowSpec) => void
    /**
     * Goes to the target as a link in a classic page does: a history entry of
     * its own, so Back returns to the view it left, and the target exactly as
     * given (no query means none, where `open` keeps the window's). Does nothing
     * when the target is the view already shown, whatever the order or encoding
     * of its query. A target whose address is the window's own (a meeting room:
     * rooms are not in the address) is shown without an entry, as `open` does.
     */
    push: (spec: WindowSpec) => void
    openApp: (app: OsAppId) => void
    close: () => void
    toast: (msg: string) => void
    fallback: ReactNode
}
