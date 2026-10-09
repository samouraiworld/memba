import type { ReactNode } from 'react'
import { FreePlayRuntimeContext, type FreePlayRuntime } from './FreePlayRuntimeContext'

/** WindowBody supplies stable dependencies to native and classic views. Keep
 * engines mounted when recovery changes; it only selects a result panel.
 * No construction, persistence, connection or API work takes place here.
 */
export function FreePlayRuntimeProvider({ value, children }: { value: FreePlayRuntime | null; children: ReactNode }) {
    return <FreePlayRuntimeContext.Provider value={value}>{children}</FreePlayRuntimeContext.Provider>
}
