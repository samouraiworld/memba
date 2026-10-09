/** DEV-only fixture: real seed/storage/reader/Worker renderer, simulated reads, no wallet. */
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createFeaturedNoteStorage } from '../../src/lib/notes/featuredNoteStorage'
import { featuredNoteLabel, planFeaturedNoteSeeds, removeFeaturedDeskItem, type FeaturedDesk, type FeaturedDeskRules, type FeaturedNoteRelease } from '../../src/lib/notes/featuredNoteSeed'
import { NOTES_REALM, type ChainNote } from '../../src/lib/notes/chain/schema'
import { bech32Encode } from '../../src/lib/dao/realmAddress'
import { PublicNote } from '../../src/os/apps/notes/PublicNote'
import { PublicComments } from '../../src/os/apps/notes/PublicComments'
import recipe from './recipe.md?raw'
import '../../src/os/apps/notes/notes-public.css'
import './fixture.css'

if (!import.meta.env.DEV) throw new Error('Local development fixture only')
const scope = { chainId: 'local-sushi-demonstration', wallet: null }
const owner = bech32Encode('g', new Uint8Array(20).fill(91))
const sushi: FeaturedNoteRelease = { releaseKey: 'sushi-v1', chainId: scope.chainId, realm: NOTES_REALM, version: 1, noteId: '71'.repeat(16), mode: 4, deleted: false, owner }
const paper: FeaturedNoteRelease = { ...sushi, releaseKey: 'whitepaper-v1', noteId: '72'.repeat(16) }
const all = [sushi, paper], rules: FeaturedDeskRules = { cols: 4, rows: 3, validItem: item => item.ty === 'note' && all.some(release => release.noteId === item.ref) }
const bytes = (text: string) => new TextEncoder().encode(text)
const client = {
    note: async (id: string): Promise<ChainNote | null> => {
        const release = all.find(value => value.noteId === id)
        return release ? { id, owner, pendingOwner: '', ownerGeneration: '1', mode: 4, stateRevision: '1', titleRevision: '1', bodyRevision: '1', epoch: '0',
            title: bytes(release === sushi ? 'Sushi recipe — local demonstration' : 'Whitepaper — local demonstration'),
            body: bytes(release === sushi ? recipe : '# Future Whitepaper demonstration\n\nA separate simulated document. Nothing has been published.'),
            commitment: new Uint8Array(), deleted: false, listed: true, createdHeight: '1', operationId: '73'.repeat(16), actor: owner, height: '1' } : null
    },
    commentsRaw: async () => ({ items: [], next_cursor: '' }),
}
type Adapter = ReturnType<typeof createFeaturedNoteStorage>
// Standalone test bootstrap mounts this component directly; it exposes no production module API.
// eslint-disable-next-line react-refresh/only-export-components
function Fixture() {
    const [whitepaper, setWhitepaper] = useState(false), [desk, setDesk] = useState<FeaturedDesk | null>(null)
    const [opened, setOpened] = useState<string | null>(null), [error, setError] = useState('')
    const active = useRef<{ adapter: Adapter; alive: boolean } | null>(null)
    useEffect(() => {
        const lease = { adapter: null as unknown as Adapter, alive: true }
        lease.adapter = createFeaturedNoteStorage({ scope, rules, storage: localStorage, locks: navigator.locks ?? null,
            readLegacy: () => null, isCurrent: () => lease.alive, getResetToken: () => null })
        active.current = lease
        const refresh = () => { if (lease.alive) { try { setDesk(lease.adapter.peek()) } catch { setError('The local demonstration desk could not be read.') } } }
        void lease.adapter.mutate(latest => planFeaturedNoteSeeds(latest, scope, rules, whitepaper ? [sushi, paper] : [sushi]).desk)
            .then(refresh, () => { if (lease.alive) setError('The local demonstration desk could not be saved.') })
        const onStorage = (event: StorageEvent) => { if (event.key === lease.adapter.key || event.key === null) refresh() }
        window.addEventListener('storage', onStorage)
        return () => { lease.alive = false; if (active.current === lease) active.current = null; window.removeEventListener('storage', onStorage) }
    }, [whitepaper])
    async function dismiss(id: string) {
        const lease = active.current
        if (!lease?.alive) return
        try {
            const next = await lease.adapter.mutate(latest => {
                const index = latest.items.findIndex(item => item.ty === 'note' && item.ref === id)
                return index < 0 ? latest : removeFeaturedDeskItem(latest, scope, rules, index)
            })
            if (lease.alive) { setDesk(next); setOpened(value => value === id ? null : value) }
        } catch { if (lease.alive) setError('The local icon could not be dismissed.') }
    }
    return <div>
        <header className="demo-notice"><h1>Local demonstration / simulated network</h1>
            <p>The recipe and comments below are simulated. Nothing has been published. Reader status labels refer to this simulated data.</p>
            <p>Guest reading only — no wallet or signature.</p>
            <label><input type="checkbox" checked={whitepaper} onChange={event => setWhitepaper(event.target.checked)} />Include future Whitepaper demonstration</label>
        </header>
        {error && <p role="alert">{error}</p>}
        <nav aria-label="Demonstration desktop">{desk?.items.map(item => {
            const release = all.find(value => value.noteId === item.ref)!
            const label = featuredNoteLabel(release.releaseKey)
            return <div key={item.ref}><button className="demo-icon" aria-label={`Open ${label}`} onClick={() => setOpened(item.ref)}><span aria-hidden="true">{release === sushi ? '🍣' : '📄'}</span>{label}</button>
                <button onClick={() => void dismiss(item.ref)}>Dismiss {label}</button></div>
        })}</nav>
        <output aria-label="Seed state">{desk ? JSON.stringify(desk.releases) : 'Loading local desk…'}</output>
        {opened && <main className="os-notes-public"><PublicNote id={opened} client={client} owner={null}>
            {(note, _refresh, previewRoot) => <PublicComments client={client} noteId={note.id} epoch={note.epoch} bodyRevision={note.bodyRevision} viewer={null} previewRoot={previewRoot} />}
        </PublicNote></main>}
    </div>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
