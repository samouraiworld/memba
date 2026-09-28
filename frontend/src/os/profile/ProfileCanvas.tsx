import { useQuery } from "@tanstack/react-query"
import { useBalance } from "../../hooks/useBalance"
import { GNO_RPC_URL, isFeedEnabled } from "../../lib/config"
import { fetchUserBadges } from "../../lib/badges"
import { getDAOMembers } from "../../lib/dao/members"
import { SEED_DAOS } from "../../lib/directory"
import { fetchUserFeed } from "../../lib/feedApi"
import { fetchNFTPortfolio } from "../../lib/nftApi"
import { fetchReviews } from "../../lib/reviews"
import { safeProfileUrl, type ProfileSection } from "./profileData"
import type { ShownProfile } from "./profileModel"

const LABELS: Record<ProfileSection, string> = {
    about: "About", links: "Links", daos: "Projects & DAOs", votes: "Governance", assets: "Public assets", credentials: "Credentials", feed: "Feed activity", reviews: "Reviews",
}

export function ProfileCanvas({ profile, preview = false }: { profile: ShownProfile; preview?: boolean }) {
    const { document, address } = profile
    const visible = (section: ProfileSection) => !document.hidden.includes(section)
    const balance = useBalance(preview ? null : address)
    const memberships = useQuery({ queryKey: ["profile", "known-daos", address], queryFn: async () => {
        const checked = await Promise.all(SEED_DAOS.map(async (dao) => ({ name: dao.name, members: await getDAOMembers(GNO_RPC_URL, dao.path, undefined, true) })))
        return checked.filter((dao) => dao.members.some((member) => member.address === address)).map((dao) => dao.name)
    }, enabled: !preview && visible("daos"), staleTime: 60_000, retry: false })
    const nfts = useQuery({ queryKey: ["profile", "nfts", address], queryFn: () => fetchNFTPortfolio(address), enabled: !preview && visible("assets"), staleTime: 60_000, retry: false })
    const badges = useQuery({ queryKey: ["profile", "badges", address], queryFn: () => fetchUserBadges(GNO_RPC_URL, address), enabled: !preview && visible("credentials"), staleTime: 60_000, retry: false })
    const feed = useQuery({ queryKey: ["profile", "feed", address], queryFn: () => fetchUserFeed(address, 0n, 5), enabled: !preview && visible("feed") && isFeedEnabled(), staleTime: 30_000, retry: false })
    const reviews = useQuery({ queryKey: ["profile", "reviews", address], queryFn: () => fetchReviews(address, 0, 5), enabled: !preview && visible("reviews"), staleTime: 60_000, retry: false })
    const cover = safeProfileUrl(document.cover)
    const homepage = safeProfileUrl(profile.homepage.value)
    const links = profile.documentPresent
        ? document.links.flatMap((link) => {
            const url = safeProfileUrl(link.url)
            return url && link.label.trim() ? [{ label: link.label.trim(), url, source: "Gno profile" }] : []
        })
        : profile.legacyLinks

    return <article className={`os-profile-canvas os-profile--${document.template} os-profile--${document.accent}`} data-testid="os-profile-canvas">
        <div className="os-profile-cover">{cover && <img src={cover} alt="" referrerPolicy="no-referrer" />}</div>
        <header className="os-profile-identity">
            <div className="os-profile-avatar">{profile.avatar ? <img src={profile.avatar} alt="" referrerPolicy="no-referrer" /> : <span aria-hidden="true">{profile.displayName.slice(0, 1).toUpperCase()}</span>}</div>
            <div className="os-profile-heading">
                <p className="os-profile-kicker">Public profile {preview ? "· local preview" : `· ${profile.displayNameSource}`}</p>
                <h1>{profile.displayName}</h1>
                {profile.username && <p className="os-profile-username">{profile.username.startsWith("@") ? profile.username : `@${profile.username}`} <span>registered name</span></p>}
                <p className="os-profile-address" title={address}>{address}</p>
                {(profile.title.value || profile.company.value) && <p className="os-profile-role">{[profile.title.value, profile.company.value].filter(Boolean).join(" · ")} <small>· {profile.title.value ? profile.title.source : profile.company.source}</small></p>}
                {profile.location.value && <p className="os-profile-meta">{profile.location.value} <small>· {profile.location.source}</small></p>}
                {homepage && <a href={homepage} target="_blank" rel="noopener noreferrer" className="os-profile-homepage">{new URL(homepage).hostname} ↗ <small>· {profile.homepage.source}</small></a>}
            </div>
        </header>
        {profile.chainProblem && !preview && <div className="os-profile-notice" role="status">Some on-chain fields could not be read. Other information is labelled by source.</div>}
        {profile.documentProblem && !preview && <div className="os-profile-notice" role="status">The saved profile layout could not be read safely. Showing the default layout.</div>}
        <div className="os-profile-sections">
            {document.sections.filter(visible).map((section) => <section key={section} className="os-profile-section" aria-label={LABELS[section]}>
                <h2>{LABELS[section]}</h2>
                {section === "about" && (profile.bio.value ? <><p className="os-profile-bio">{profile.bio.value}</p><small>Source: {profile.bio.source}</small></> : <p className="os-profile-muted">No introduction yet.</p>)}
                {section === "links" && (links.length ? <ul className="os-profile-links">{links.map((link) => <li key={`${link.label}:${link.url}`}><a href={link.url} target="_blank" rel="noopener noreferrer">{link.label} ↗</a><small>{new URL(link.url).hostname} · {link.source}</small></li>)}</ul> : <p className="os-profile-muted">No public links yet.</p>)}
                {section === "daos" && <>
                    {preview ? <p className="os-profile-muted">Known DAO memberships appear here after publishing.</p> : memberships.isLoading ? <p className="os-profile-muted">Checking known DAO memberships…</p> : memberships.isError ? <p className="os-profile-muted">DAO membership could not be checked right now.</p> : memberships.data?.length ? <ul>{memberships.data.map((name) => <li key={name}>{name} <small>· Gno member roster</small></li>)}</ul> : <p className="os-profile-muted">No membership found in the checked DAO roster.</p>}
                    {profile.deployedPackages.length > 0 && <ul>{profile.deployedPackages.slice(0, 6).map((pkg) => <li key={pkg.path}>{pkg.path} <small>· Gnolove package index</small></li>)}</ul>}
                </>}
                {section === "votes" && (profile.governanceVotes.length ? <ul>{profile.governanceVotes.slice(0, 6).map((vote) => <li key={vote.proposalId}>{vote.proposalTitle || `Proposal ${vote.proposalId}`} · {vote.vote} <small>· Gnolove index</small></li>)}</ul> : <p className="os-profile-muted">No governance votes from the Gnolove index.</p>)}
                {section === "assets" && (preview ? <p className="os-profile-muted">Public balances and indexed NFTs appear here after publishing.</p> : <>
                    <p>{balance.loading ? "Loading GNOT balance…" : balance.error ? "GNOT balance unavailable." : balance.balance} <small>· Gno bank</small></p>
                    {nfts.isLoading ? <p className="os-profile-muted">Loading indexed NFTs…</p> : nfts.data?.length ? <ul>{nfts.data.slice(0, 6).map((token) => <li key={`${token.collectionId}:${token.tokenId}`}>{token.collectionId} #{token.tokenId} <small>· Memba NFT index</small></li>)}</ul> : <p className="os-profile-muted">No NFTs available from the Memba index.</p>}
                </>)}
                {section === "credentials" && (preview ? <p className="os-profile-muted">Public badges appear here after publishing.</p> : badges.isLoading ? <p className="os-profile-muted">Loading badges…</p> : badges.data?.badges.length ? <ul>{badges.data.badges.filter((badge) => badge.owner === address).slice(0, 8).map((badge) => <li key={badge.tokenId}>{badge.questTitle || badge.questId} <small>· GnoBuilders badge realm or local cache</small></li>)}</ul> : <p className="os-profile-muted">No badges available from the badge realm or local cache.</p>)}
                {section === "feed" && (preview ? <p className="os-profile-muted">Recent public posts appear here after publishing.</p> : !isFeedEnabled() ? <p className="os-profile-muted">Feed is unavailable on this network.</p> : feed.isLoading ? <p className="os-profile-muted">Loading posts…</p> : feed.isError ? <p className="os-profile-muted">Posts are unavailable right now.</p> : feed.data?.posts.length ? <ul>{feed.data.posts.map((post) => <li key={String(post.id)}>{String(post.body).slice(0, 240)} <small>· Feed index</small></li>)}</ul> : <p className="os-profile-muted">No indexed posts yet.</p>)}
                {section === "reviews" && (preview ? <p className="os-profile-muted">On-chain reviews appear here after publishing.</p> : reviews.isLoading ? <p className="os-profile-muted">Loading reviews…</p> : reviews.isError ? <p className="os-profile-muted">Reviews are unavailable right now.</p> : reviews.data?.length ? <ul>{reviews.data.map((review) => <li key={review.id}>{review.rating}/5 · {review.body.slice(0, 240)} <small>· Memba reviews realm</small></li>)}</ul> : <p className="os-profile-muted">No public reviews yet.</p>)}
            </section>)}
        </div>
    </article>
}
