import { lazy, Suspense, type ReactNode } from 'react'
import { useWindowActive, WindowActivityContext } from '../../../../os/page/WindowActivity'
import type { FpsSavedResults } from './bridge'

export interface FpsRecoverySelection { clientRunId: string; onClose(): void }
const Recovery = lazy(() => import('./SelectedResult'))
/** Selection is a sibling of the existing engine, never an instruction to Play. */
export function RecoveryBoundary({ children, recovery, saved }: { children: ReactNode; recovery?: FpsRecoverySelection | null; saved?: FpsSavedResults }) {
    const active = useWindowActive()
    return <div className="bar-recovery-frame">
        <div inert={!!recovery} aria-hidden={recovery ? true : undefined}>
            <WindowActivityContext.Provider value={active && !recovery}>{children}</WindowActivityContext.Provider>
        </div>
        {recovery && <div className="bar-recovery-overlay"><Suspense fallback={<p role="status">Ouverture de la sauvegarde…</p>}>
            <Recovery key={recovery.clientRunId} selection={recovery} saved={saved} />
        </Suspense></div>}
    </div>
}
