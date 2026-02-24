export function Dashboard() {
    return (
        <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            {/* ── Page header ────────────────────────────────────────── */}
            <div>
                <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>Dashboard</h2>
                <p style={{ color: '#999', fontSize: 14, marginTop: 4 }}>
                    Manage your multisig wallets and transactions
                </p>
            </div>

            {/* ── Stat cards ─────────────────────────────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                <StatCard label="Multisigs" value="0" />
                <StatCard label="Pending TX" value="0" accent />
                <StatCard label="Balance" value="— GNOT" />
            </div>

            {/* ── Empty state ────────────────────────────────────────── */}
            <div className="k-dashed" style={{ background: '#0c0c0c', padding: 48, textAlign: 'center' }}>
                <div style={{
                    width: 56, height: 56, borderRadius: 12, margin: '0 auto 20px',
                    border: '1px dashed rgba(0,212,170,0.2)', background: 'rgba(0,212,170,0.05)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(0,212,170,0.5)" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                </div>
                <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>No multisigs yet</h3>
                <p style={{ color: '#999', fontSize: 14, marginBottom: 24, maxWidth: 400, margin: '0 auto 24px' }}>
                    Create a new multisig wallet or import an existing one to get started.
                </p>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button className="k-btn-primary" id="create-multisig-btn">
                        Create Multisig
                    </button>
                    <button className="k-btn-secondary" id="import-multisig-btn">
                        Import by Address
                    </button>
                </div>
            </div>

            {/* ── Pending Transactions ───────────────────────────────── */}
            <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#00d4aa' }} className="animate-glow" />
                    <h3 style={{ fontSize: 16, fontWeight: 500 }}>Pending Transactions</h3>
                    <span className="k-label" style={{ marginLeft: 'auto' }}>0 pending</span>
                </div>
                <div className="k-card" style={{ textAlign: 'center', padding: 32 }}>
                    <p style={{ color: '#555', fontSize: 14, fontFamily: 'JetBrains Mono, monospace' }}>
                        No pending transactions
                    </p>
                </div>
            </div>

            {/* ── Recent Activity ────────────────────────────────────── */}
            <div>
                <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>Recent Activity</h3>
                <div className="k-card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{
                        padding: '12px 20px', borderBottom: '1px solid #222',
                        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr',
                        fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#555',
                        textTransform: 'uppercase', letterSpacing: '0.05em',
                    }}>
                        <span>Type</span>
                        <span>Amount</span>
                        <span>Status</span>
                        <span style={{ textAlign: 'right' }}>Date</span>
                    </div>
                    <div style={{ padding: 32, textAlign: 'center' }}>
                        <p style={{ color: '#555', fontSize: 14, fontFamily: 'JetBrains Mono, monospace' }}>
                            No activity yet
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
    return (
        <div className={`k-card ${accent ? 'k-card-accent' : ''}`}>
            <p className="k-label">{label}</p>
            <p className={`k-value ${accent ? 'k-value-accent' : ''}`}>{value}</p>
        </div>
    )
}
