import type { ComponentProps } from "react"
import type { DesktopShell } from "./DesktopShell"
import { Sidebar } from "./Sidebar"

/** The same main column survives crossing the mobile breakpoint. Only the
 * sidebar mounts/unmounts; routes retain their local state and DOM identity. */
export function ResponsiveShell({ mobile, children, ...sidebar }: ComponentProps<typeof DesktopShell> & { mobile: boolean }) {
    return <>
        {!mobile && <Sidebar {...sidebar} />}
        <div className="k-main-column">{children}</div>
    </>
}
