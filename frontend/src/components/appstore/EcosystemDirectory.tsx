import { ArrowUpRight, Wallet, ArrowsLeftRight, ChatsCircle, Cube, MagnifyingGlass, Code } from "@phosphor-icons/react"
import "./ecosystem-directory.css"

// Editorial links, not AppListing records: no invented realm paths, review scores,
// verification badges or claims of availability on the selected network.
// Sources: docs/design/professional-mainnet-2026-09/ECOSYSTEM-SOURCES.md.
const ECOSYSTEM_APPS = [
    { name: "Adena", category: "Wallet", Icon: Wallet, url: "https://adena.app/", host: "adena.app", status: "Browser wallet", description: "Manage your Gno accounts and connect to apps with a browser extension." },
    { name: "GnoSwap", category: "Exchange", Icon: ArrowsLeftRight, url: "https://beta.gnoswap.io/", host: "beta.gnoswap.io", status: "Beta", description: "Explore token swaps and liquidity pools built for the Gno ecosystem." },
    { name: "Boards", category: "Community", Icon: ChatsCircle, url: "https://gno.land/r/gnoland/boards2/v0", host: "gno.land", status: "On-chain forum", description: "Read discussions, share ideas, and take part in community conversations." },
    { name: "Akkadia", category: "World building", Icon: Cube, url: "https://abp.akkadia.land/", host: "abp.akkadia.land", status: "Builder preview", description: "Discover a sandbox for creating shared worlds, with creations recorded on Gno." },
    { name: "GnoScan", category: "Explorer", Icon: MagnifyingGlass, url: "https://gnoscan.io/", host: "gnoscan.io", status: "Network explorer", description: "Look up accounts, transactions, blocks, and realms across Gno networks." },
    { name: "Gno Playground", category: "Developer tools", Icon: Code, url: "https://play.gno.land/", host: "play.gno.land", status: "Browser workspace", description: "Write, run, and share Gno code directly in your browser." },
] as const

export function EcosystemDirectory({ standalone = false }: { standalone?: boolean }) {
    return (
        <section className="ecosystem-directory" aria-label="Gno ecosystem apps">
            <header className="ecosystem-directory__header">
                <p className="ecosystem-directory__eyebrow">Built on Gno</p>
                <h1>App Store</h1>
                <p>Tools for your next idea. Discover wallets, communities, creative worlds, and apps built around Gno.</p>
            </header>
            <ul className="ecosystem-directory__grid">
                {ECOSYSTEM_APPS.map(({ name, category, Icon, url, host, status, description }) => (
                    <li key={name}>
                        <a className="ecosystem-app" href={url} target="_blank" rel="noopener noreferrer" aria-label={`Visit ${name} (opens in a new tab)`}>
                            <div className="ecosystem-app__top"><span className="ecosystem-app__icon"><Icon size={26} aria-hidden="true" /></span><span>{category}</span><ArrowUpRight size={18} aria-hidden="true" /></div>
                            <h3>{name}</h3>
                            <p>{description}</p>
                            <div className="ecosystem-app__footer"><span>{status}</span><span>{host}</span></div>
                        </a>
                    </li>
                ))}
            </ul>
            <p className="ecosystem-directory__note">These links open independent projects outside Memba. Each app manages its own network selection and availability.{!standalone && " Ecosystem links are separate from the on-chain listings below."}</p>
            {standalone && <div className="ecosystem-directory__registry"><h2>On-chain listings are coming soon</h2><p>Browse the ecosystem above while Memba’s publishing and review features are unavailable here.</p></div>}
        </section>
    )
}
