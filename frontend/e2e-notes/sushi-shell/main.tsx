/** DEV ONLY. Real Shell, stages, native public reader/composer. Auth and read transport are fixtures. */
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { Shell } from '../../src/os/shell/Shell'
import { audit, NOTE_ID } from './audit'
import '../../src/os/os.css'
import '../../src/os/os-fonts.css'
import '../../src/os/shell/shell.css'
import '../../src/os/classic-bridge.css'
import '../../src/os/kit/kit.css'
if (!import.meta.env.DEV) throw new Error('Development fixture only')
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
Object.defineProperty(window, '__notesShellAudit', { get: () => ({ disconnects: audit.disconnects, clients: audit.clients.length, liveClients: audit.clients.filter(client => client.isCurrent()).length }) })
localStorage.setItem('memba_os_skip_intro', '1'); localStorage.removeItem('memba_os_locked')
createRoot(document.getElementById('root')!).render(<div className="memba-os" style={{ height: '100vh' }}><MemoryRouter initialEntries={[`/os/notes/${NOTE_ID}`]}><QueryClientProvider client={queryClient}><Shell /></QueryClientProvider></MemoryRouter></div>)
