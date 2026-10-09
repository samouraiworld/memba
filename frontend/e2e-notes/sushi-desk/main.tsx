/** DEV ONLY. Real Shell, stages, native public reader/composer. Auth and read transport are fixtures. */
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import OsRoot from '../../src/os/OsRoot'
import { audit } from '../sushi-shell/audit'
import '../../src/os/os.css'
import '../../src/os/os-fonts.css'
import '../../src/os/shell/shell.css'
import '../../src/os/classic-bridge.css'
import '../../src/os/kit/kit.css'
if (!import.meta.env.DEV) throw new Error('Development fixture only')
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
Object.defineProperty(window, '__notesShellAudit', { get: () => ({ disconnects: audit.disconnects, clients: audit.clients.length, liveClients: audit.clients.filter(client => client.isCurrent()).length }) })
if (new URLSearchParams(location.search).get('paper') === '1') localStorage.setItem('fixture:desk:paper', '1')
localStorage.setItem('memba_os_skip_intro', '1'); localStorage.removeItem('memba_os_locked')
createRoot(document.getElementById('root')!).render(<><p style={{ position: 'fixed', bottom: 0, left: 4, zIndex: 500, margin: 0, fontSize: 11, color: '#fff', background: '#333' }}>Simulated local Notes desk — no wallet or RPC</p><div style={{ height: '100vh' }}><MemoryRouter initialEntries={['/os']}><QueryClientProvider client={queryClient}><OsRoot /></QueryClientProvider></MemoryRouter></div></>)
