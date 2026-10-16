/**
 * DEV ONLY. Real Shell, Notes stages, private-notes chunk, key controller, crypto, IndexedDB drafts and signing sheets.
 * Seams: the account session, the Notes read transport (client.ts, simulated onyx-1 state) and Adena's SignArbitrary.
 * Nothing is ever signed: the spec stops at each signature review.
 */
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { Shell } from '../../src/os/shell/Shell'
import { audit } from './client'
import { TEST_ACCOUNT } from './session'
import { accounts, buildWorld, NOTE_ID, signUnlock } from './world'
import '../../src/os/os.css'
import '../../src/os/os-fonts.css'
import '../../src/os/shell/shell.css'
import '../../src/os/classic-bridge.css'
import '../../src/os/kit/kit.css'
if (!import.meta.env.DEV) throw new Error('Development fixture only')

/** Every byte this origin stores, searched for a marker (IndexedDB values decoded as UTF-8, Web Storage as text). */
async function stored(marker: string): Promise<{ hits: string[]; records: number }> {
    const hits: string[] = [], decoder = new TextDecoder(), seen = new WeakSet<object>()
    let records = 0
    const scan = (where: string, value: unknown) => {
        if (typeof value === 'string') { if (value.includes(marker)) hits.push(where); return }
        if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) { if (decoder.decode(value instanceof ArrayBuffer ? value : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)).includes(marker)) hits.push(where); return }
        if (value && typeof value === 'object' && !seen.has(value)) { seen.add(value); for (const [key, item] of Object.entries(value)) scan(`${where}.${key}`, item) }
    }
    for (const info of await indexedDB.databases()) {
        const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(info.name!); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
        for (const name of [...db.objectStoreNames]) {
            const all = await new Promise<unknown[]>((resolve, reject) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
            records += all.length; all.forEach((value, i) => scan(`${info.name}/${name}[${i}]`, value))
        }
        db.close()
    }
    for (const [label, storage] of [['localStorage', localStorage], ['sessionStorage', sessionStorage]] as const)
        for (let i = 0; i < storage.length; i++) { const key = storage.key(i)!; scan(`${label}:${key}`, key); scan(`${label}:${key}`, storage.getItem(key)) }
    return { hits, records }
}
Object.defineProperty(window, '__notesPrivate', { value: { stored, liveClients: () => audit.clients.filter(client => client.isCurrent()).length, unlockRequests: 0, newcomer: accounts.newcomer.address } })
// Adena's arbitrary signing only (no transaction is ever signed here): deterministic, like a real Adena key.
Object.defineProperty(window, 'adena', { value: { SignArbitrary: async ({ signer }: { signer: string }) => {
    (window as unknown as { __notesPrivate: { unlockRequests: number } }).__notesPrivate.unlockRequests++
    return signUnlock(TEST_ACCOUNT, signer)
} } })
localStorage.setItem('memba_os_skip_intro', '1'); localStorage.removeItem('memba_os_locked')
await buildWorld()
const start = new URLSearchParams(location.search).get('start') ?? `/os/notes/${NOTE_ID}`
createRoot(document.getElementById('root')!).render(<div className="memba-os" style={{ height: '100vh' }}><MemoryRouter initialEntries={[start]}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Shell /></QueryClientProvider></MemoryRouter></div>)
document.documentElement.dataset.fixtureReady = 'true'
