import { useLayoutEffect, useState } from 'react'
import type { NativeViewProps } from '../../native/types'
import { createNotesStore } from '../../../lib/notes/drafts'
import { NOTE_ID, NOTES_ENABLED, notesDeployment } from '../../../lib/notes/config'
import { NotesReadClient } from '../../../lib/notes/chain/client'
import { getRpcUrlsInOrder } from '../../../lib/rpcFallback'
import { PublicLibrary } from './PublicLibrary'
import { PublicNote } from './PublicNote'
import { PublicCommentPanel } from './PublicCommentPanel'
import './notes-public.css'

const store = createNotesStore()
type Props = Pick<NativeViewProps, 'session' | 'section' | 'fallback'> & { onOpenNote(id: string): void }

/** Dormant public reader. The shell owns registration, navigation and stable mounting. */
export function PublicNotesApp(props: Props) {
    if (!NOTES_ENABLED) return props.fallback
    const owner = props.session.status === 'member' ? props.session.address || null : null
    return <PublicWorkspace key={JSON.stringify([props.session.network.chainId, owner, props.section])} {...props} owner={owner} />
}
function PublicWorkspace({ session, section, owner, onOpenNote }: Props & { owner: string | null }) {
    const chainId = session.network.chainId
    const [read, setRead] = useState<{ client: NotesReadClient | null; error: boolean }>({ client: null, error: false })
    const [attempt, retry] = useState(0)
    const deployment = notesDeployment(chainId)
    useLayoutEffect(() => {
        if (!deployment) return
        const lifetime = new AbortController()
        try {
            const client = new NotesReadClient({ chainId, deployment, rpcUrls: getRpcUrlsInOrder(), isCurrent: () => !lifetime.signal.aborted })
            // The client belongs to this effect lifetime, including StrictMode remounts.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setRead({ client, error: false })
        } catch { setRead({ client: null, error: true }) }
        return () => lifetime.abort()
    }, [chainId, deployment, attempt])
    if (section !== null && !NOTE_ID.test(section)) return <p role="alert">Invalid note address.</p>
    if (!deployment) return <section className="os-notes-welcome"><h1>Public notes</h1><p>Notes are not available on this network yet.</p></section>
    if (read.error) return <section className="os-notes-welcome"><p role="alert">Notes could not connect to this network.</p><button className="os-btn" onClick={() => retry(value => value + 1)}>Retry connection</button></section>
    if (!read.client) return <p role="status">Loading Notes…</p>
    const client = read.client
    return <div className="os-notes-public">
        {section === null ? <PublicLibrary client={client} onOpen={id => { if (NOTE_ID.test(id)) onOpenNote(id) }} />
            : <PublicNote id={section} client={client} owner={owner}
                encrypted={() => <section className="os-notes-welcome"><h1>Encrypted note</h1><p>Encrypted notes are not available in this public view.</p></section>}>
                {(note, _refresh, previewRoot) => note.mode >= 3 && <PublicCommentPanel note={note} client={client} owner={owner} store={store} previewRoot={previewRoot} />}
            </PublicNote>}
    </div>
}
