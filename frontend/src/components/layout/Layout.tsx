import { Outlet } from 'react-router-dom'

export function Layout() {
    return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#000', color: '#f0f0f0' }}>
            {/* ── Header ──────────────────────────────────────────────── */}
            <header className="k-glass" style={{ position: 'sticky', top: 0, zIndex: 50, borderBottom: '1px solid #1a1a1a' }}>
                <div style={{ maxWidth: 1152, margin: '0 auto', padding: '0 24px', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    {/* Logo */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div
                            className="animate-glow"
                            style={{
                                width: 36, height: 36, borderRadius: 8,
                                border: '1px dashed rgba(0,212,170,0.35)',
                                background: 'rgba(0,212,170,0.06)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                        >
                            <span style={{ color: '#00d4aa', fontFamily: 'JetBrains Mono, monospace', fontSize: 14, fontWeight: 700 }}>M</span>
                        </div>
                        <div>
                            <h1 style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.2 }}>Memba</h1>
                            <p style={{ fontSize: 10, color: '#555', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.2em' }}>メンバー</p>
                        </div>
                    </div>

                    {/* Right side */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <span style={{ fontSize: 12, color: '#555', fontFamily: 'JetBrains Mono, monospace' }}>test11</span>
                        <div style={{ width: 1, height: 20, background: '#222' }} />
                        <button className="k-btn-wallet" id="connect-wallet-btn">
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#00d4aa', display: 'inline-block' }} />
                            Connect Wallet
                        </button>
                    </div>
                </div>
            </header>

            {/* ── Content ─────────────────────────────────────────────── */}
            <main style={{ flex: 1, maxWidth: 1152, margin: '0 auto', width: '100%', padding: '32px 24px' }}>
                <Outlet />
            </main>

            {/* ── Footer ──────────────────────────────────────────────── */}
            <footer style={{ borderTop: '1px solid #1a1a1a' }}>
                <div style={{
                    maxWidth: 1152, margin: '0 auto', padding: '0 24px', height: 48,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    fontSize: 11, color: '#555', fontFamily: 'JetBrains Mono, monospace',
                }}>
                    <span>memba v0.1.0-dev</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(0,212,170,0.6)' }} />
                        <span>test11 · samourai.coop</span>
                    </div>
                </div>
            </footer>
        </div>
    )
}
