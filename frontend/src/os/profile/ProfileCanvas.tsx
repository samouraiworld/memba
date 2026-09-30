import { useId, useState, type KeyboardEvent } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNetworkPath } from "../../hooks/useNetworkNav"
import { useBalance } from "../../hooks/useBalance"
import { GNO_CHAIN_ID, GNO_RPC_URL, getExplorerBaseUrl, isFeedEnabled } from "../../lib/config"
import { fetchUserBadges } from "../../lib/badges"
import { fetchUserFeed } from "../../lib/feedApi"
import { fetchNFTPortfolio } from "../../lib/nftApi"
import { ReviewsModeration } from "../../components/reviews/ModerationPolicy"
import { fetchReviews } from "../../lib/reviews"
import { safeProfileUrl, type ProfileSection } from "./profileData"
import type { ShownProfile } from "./profileModel"
import { readHomeRealm } from "./profileHome"
import { readProfileMemberships } from "./profileMemberships"

const LABELS: Record<ProfileSection, string> = {
    about: "About", links: "Links", daos: "Memberships and roles", votes: "Governance votes", assets: "Public assets", credentials: "Credentials", feed: "Feed activity", reviews: "Reviews",
}
type ProfileTab = "overview" | "home" | "daos" | "contributions" | "feed"
const TAB_NAMES: Record<ProfileTab, string> = { overview: "Overview", home: "Home", daos: "DAOs", contributions: "Contributions", feed: "Feed" }

export function ProfileCanvas({ profile, preview = false }: { profile: ShownProfile; preview?: boolean }) {
    const { document, address } = profile
    const [selectedTab, setSelectedTab] = useState<ProfileTab>("overview")
    const [feedKind, setFeedKind] = useState<"posts" | "replies">("posts")
    const networkPath = useNetworkPath()
    const tabId = useId().replace(/:/g, "")
    const visible = (section: ProfileSection) => !document.hidden.includes(section)
    const tabs: ProfileTab[] = ["overview", "home", ...(visible("daos") || visible("votes") ? ["daos" as const] : []), "contributions", ...(visible("feed") ? ["feed" as const] : [])]
    const tab = tabs.includes(selectedTab) ? selectedTab : "overview"
    const balance = useBalance(preview ? null : address)
    const home = useQuery({ queryKey: ["profile", "home", GNO_CHAIN_ID, address], queryFn: () => readHomeRealm(address), enabled: !preview, staleTime: 60_000, retry: false })
    const memberships = useQuery({ queryKey: ["profile", "known-daos", GNO_CHAIN_ID, address], queryFn: () => readProfileMemberships(address), enabled: !preview && visible("daos"), staleTime: 60_000, retry: false })
    const nfts = useQuery({ queryKey: ["profile", "nfts", address], queryFn: () => fetchNFTPortfolio(address), enabled: !preview && visible("assets"), staleTime: 60_000, retry: false })
    const badges = useQuery({ queryKey: ["profile", "badges", address], queryFn: () => fetchUserBadges(GNO_RPC_URL, address), enabled: !preview && visible("credentials"), staleTime: 60_000, retry: false })
    const feed = useQuery({ queryKey: ["profile", "feed", GNO_CHAIN_ID, address], queryFn: () => fetchUserFeed(address, 0n, 30), enabled: !preview && visible("feed") && isFeedEnabled(), staleTime: 30_000, retry: false })
    const reviews = useQuery({ queryKey: ["profile", "reviews", address], queryFn: () => fetchReviews(address, 0, 5), enabled: !preview && visible("reviews"), staleTime: 60_000, retry: false })
    const cover = safeProfileUrl(document.cover)
    const homepage = safeProfileUrl(profile.homepage.value)
    const links = profile.documentPresent
        ? document.links.flatMap((link) => {
            const url = safeProfileUrl(link.url)
            return url && link.label.trim() ? [{ label: link.label.trim(), url, source: "Gno profile" }] : []
        })
        : profile.legacyLinks
    const homeFound = home.data?.status === "found"
    const feedPosts = (feed.data?.posts ?? []).filter((post) => (post.replyTo > 0n) === (feedKind === "replies") && !!post.body).slice(0, 8)
    const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        const current = tabs.indexOf(tab)
        let next = current
        if (event.key === "ArrowRight") next = (current + 1) % tabs.length
        else if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length
        else if (event.key === "Home") next = 0
        else if (event.key === "End") next = tabs.length - 1
        else return
        event.preventDefault()
        setSelectedTab(tabs[next])
        window.document.getElementById(tabId + "-tab-" + tabs[next])?.focus()
    }

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
        <div className="os-profile-provenance"><span>Shared Gno profile</span><span>{preview ? "Home discovered on live view" : home.isLoading ? "Checking personal Home…" : homeFound ? "On-chain Home found" : home.data?.status === "missing" ? "No Home realm found" : "Home lookup unavailable"}</span><span>Activity labelled by source</span></div>
        {profile.chainProblem && !preview && <div className="os-profile-notice" role="status">Some on-chain fields could not be read or shown. Other information is labelled by source.</div>}
        {profile.documentProblem && !preview && <div className="os-profile-notice" role="status">The saved profile layout could not be read by this version of Memba. Showing the default layout.</div>}
        <div className="os-profile-tablist" role="tablist" aria-label="Profile sections">{tabs.map((name) => <button key={name} type="button" role="tab" id={tabId + "-tab-" + name} aria-controls={tabId + "-panel-" + name} aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} onClick={() => setSelectedTab(name)} onKeyDown={onTabKeyDown}>{TAB_NAMES[name]}{name === "home" && homeFound && <span className="os-profile-tab-dot" aria-label="found" />}</button>)}</div>
        <div className="os-profile-tabpanel" role="tabpanel" id={tabId + "-panel-" + tab} aria-labelledby={tabId + "-tab-" + tab} tabIndex={0}>
        <div className="os-profile-panel-head"><h2>{tab === "daos" ? "DAOs and governance" : tab === "home" ? "Personal Home" : tab === "feed" ? "Feed activity" : TAB_NAMES[tab]}</h2><p>{tab === "overview" ? "Identity, personal Home, and public signals around this address." : tab === "home" ? "An address-owned realm, separate from this editable profile." : tab === "daos" ? "Roles from checked rosters; votes from the Gnolove index." : tab === "contributions" ? "Published packages and contributions, with their sources." : "Recent posts and replies from the indexed public Feed."}</p></div>
        {tab === "overview" && <>
            <section className="os-profile-home-feature" aria-label="Personal Home"><span className="os-profile-feature-mark" aria-hidden="true">⌂</span><div><small>PERSONAL GNO REALM · OWNER-AUTHORED</small><h3>{home.data?.status === "found" ? home.data.title : "Home on Gno"}</h3><p>{preview ? "An address-owned Home appears here on a live profile." : home.isLoading ? "Checking this address for a Home realm…" : home.data?.status === "found" ? home.data.summary || "This address has a public Home realm." : home.data?.status === "missing" ? "No Home realm was found for this address." : "Home could not be checked right now."}</p>{home.data?.status === "found" && <div className="os-profile-feature-actions"><button type="button" onClick={() => setSelectedTab("home")}>Explore Home</button><a href={home.data.url} target="_blank" rel="noopener noreferrer">Open original realm ↗</a></div>}</div></section>
            <div className="os-profile-overview-facts"><div><span>Personal Home</span><strong>{preview ? "Live view only" : homeFound ? "Discovered" : home.isLoading ? "Checking" : home.data?.status === "missing" ? "Not found" : "Unavailable"}</strong><small>Address namespace</small></div><div><span>DAO roles</span><strong>{preview ? "Live view only" : memberships.isLoading ? "Checking" : memberships.isError || !memberships.data?.checked ? "Unavailable" : memberships.data.memberships.length ? memberships.data.memberships.length + " found" : memberships.data.failed ? "Partial check" : "No match yet"}</strong><small>Known rosters only</small></div><div><span>Published packages</span><strong>{profile.deployedPackages.length ? profile.deployedPackages.length + " indexed" : "No data returned"}</strong><small>Gnolove package index</small></div></div>
            <p className="os-profile-coverage">Home content is owner-authored. DAO roles and contribution counts need their own source; Memba does not infer them from a Home page.</p>
        </>}
        {tab === "home" && (preview ? <div className="os-profile-section"><p className="os-profile-muted">A live Home excerpt and original realm link will appear here.</p></div> : home.isLoading ? <div className="os-profile-section"><p>Checking Home realm…</p></div> : home.data?.status === "found" ? <div className="os-profile-home-detail"><section className="os-profile-section"><h3>{home.data.title}</h3><p>{home.data.summary || "This realm has no text excerpt."}</p><p className="os-profile-muted">Preview text only. Interactive content and the complete page remain on Gno.</p><a href={home.data.url} target="_blank" rel="noopener noreferrer" className="os-profile-primary-link">View complete Home ↗</a></section><aside className="os-profile-section"><h3>About this page</h3><p>Public content published under this address. Claims here are owner-authored and are not verified DAO roles or credentials.</p><code>{home.data.path}</code></aside></div> : <div className="os-profile-section"><p>{home.data?.status === "missing" ? "No Home realm is published at this address." : "Home is unavailable right now. Try again later."}</p><code>{home.data?.path}</code></div>)}
        {tab === "contributions" && <>
            <section className="os-profile-section"><h3>Published packages</h3>{profile.deployedPackages.length ? <ul className="os-profile-activity-list">{profile.deployedPackages.slice(0, 12).map((pkg) => <li key={pkg.path}><a href={getExplorerBaseUrl() + "/" + pkg.path.replace(/^gno\.land\//, "")} target="_blank" rel="noopener noreferrer">{pkg.path} ↗</a><small>Gnolove package index</small></li>)}</ul> : <p className="os-profile-muted">No packages available from the Gnolove index.</p>}</section>
            <section className="os-profile-section"><h3>Linked GitHub activity</h3>{profile.githubActivity ? <><p><a href={"https://github.com/" + encodeURIComponent(profile.githubActivity.login)} target="_blank" rel="noopener noreferrer">@{profile.githubActivity.login} ↗</a> <small>· Gnolove linked account</small></p><div className="os-profile-github-stats"><span>{profile.githubActivity.commits} commits</span><span>{profile.githubActivity.pullRequests} PRs</span><span>{profile.githubActivity.issues} issues</span><span>{profile.githubActivity.reviews} reviews</span></div><p className="os-profile-coverage">Counts reflect the activity returned by Gnolove, with no period asserted.</p></> : <p className="os-profile-muted">No linked GitHub activity available from Gnolove.</p>}</section>
            <section className="os-profile-section"><h3>Contribution ranks</h3><p className="os-profile-muted">A rank appears only when an index names the linked account, metric, and period. No verified rank is available here.</p></section>
        </>}
        {tab === "feed" && <div className="os-profile-feed-switch" role="group" aria-label="Feed type"><button type="button" aria-pressed={feedKind === "posts"} onClick={() => setFeedKind("posts")}>Posts</button><button type="button" aria-pressed={feedKind === "replies"} onClick={() => setFeedKind("replies")}>Replies</button></div>}
        <div className="os-profile-sections">
            {document.sections.filter(visible).filter((section) => tab === "overview" ? ["about", "links", "assets", "credentials", "reviews"].includes(section) : tab === "daos" ? ["daos", "votes"].includes(section) : tab === "feed" ? section === "feed" : false).map((section) => <section key={section} className="os-profile-section" aria-label={LABELS[section]}>
                <h2>{LABELS[section]}</h2>
                {section === "about" && (profile.bio.value ? <><p className="os-profile-bio">{profile.bio.value}</p><small>Source: {profile.bio.source}</small></> : <p className="os-profile-muted">No introduction in the shared profile yet. The personal Home may tell you more.</p>)}
                {section === "links" && (links.length ? <ul className="os-profile-links">{links.map((link) => <li key={`${link.label}:${link.url}`}><a href={link.url} target="_blank" rel="noopener noreferrer">{link.label} ↗</a><small>{new URL(link.url).hostname} · {link.source}</small></li>)}</ul> : <p className="os-profile-muted">No public links yet.</p>)}
                {section === "daos" && <>
                    {preview ? <p className="os-profile-muted">Known DAO rosters are checked on a live profile.</p> : memberships.isLoading ? <p className="os-profile-muted">Checking known DAO rosters…</p> : memberships.isError ? <p className="os-profile-muted">DAO rosters are unavailable right now.</p> : memberships.data?.memberships.length ? <ul className="os-profile-activity-list">{memberships.data.memberships.map((member) => <li key={member.path}><strong>{member.name}</strong><small>{member.path} · on-chain member roster</small><div className="os-profile-role-tags">{member.roles.map(role => <span key={role}>{role}</span>)}{member.tier && <span>Tier: {member.tier}</span>}{member.votingPower > 0 && <span>Voting power: {member.votingPower}</span>}{!member.roles.length && !member.tier && member.votingPower === 0 && <span>Member</span>}</div></li>)}</ul> : <p className="os-profile-muted">No membership found in the rosters checked so far.</p>}
                    {memberships.data && <><p className="os-profile-coverage">Checked {memberships.data.checked} known roster{memberships.data.checked === 1 ? "" : "s"}{memberships.data.failed ? "; " + memberships.data.failed + " unavailable" : ""}{memberships.data.omitted ? "; " + memberships.data.omitted + " not checked in this view" : ""}. This is not a complete list of DAOs on Gno.</p>{memberships.data.checkedRealms.length > 0 && <details className="os-profile-checked-realms"><summary>Rosters checked</summary><ul>{memberships.data.checkedRealms.map(realm => <li key={realm.path}>{realm.name} <small>{realm.path}</small></li>)}</ul></details>}</>}
                </>}
                {section === "votes" && (profile.governanceVotes.length ? <ul>{profile.governanceVotes.slice(0, 6).map((vote) => <li key={vote.proposalId}>{vote.proposalTitle || `Proposal ${vote.proposalId}`} · {vote.vote} <small>· Gnolove index</small></li>)}</ul> : <p className="os-profile-muted">No governance votes from the Gnolove index.</p>)}
                {section === "assets" && (preview ? <p className="os-profile-muted">Public balances and indexed NFTs appear here after publishing.</p> : <>
                    <p>{balance.loading ? "Loading GNOT balance…" : balance.error ? "GNOT balance unavailable." : balance.balance} <small>· Gno bank</small></p>
                    {nfts.isLoading ? <p className="os-profile-muted">Loading indexed NFTs…</p> : nfts.data?.length ? <ul>{nfts.data.slice(0, 6).map((token) => <li key={`${token.collectionId}:${token.tokenId}`}>{token.collectionId} #{token.tokenId} <small>· Memba NFT index</small></li>)}</ul> : <p className="os-profile-muted">No NFTs available from the Memba index.</p>}
                </>)}
                {section === "credentials" && (preview ? <p className="os-profile-muted">Public badges appear here after publishing.</p> : badges.isLoading ? <p className="os-profile-muted">Loading badges…</p> : badges.data?.badges.length ? <ul>{badges.data.badges.filter((badge) => badge.owner === address).slice(0, 8).map((badge) => <li key={badge.tokenId}>{badge.questTitle || badge.questId} <small>· GnoBuilders badge realm or local cache</small></li>)}</ul> : <p className="os-profile-muted">No badges available from the badge realm or local cache.</p>)}
                {section === "feed" && (preview ? <p className="os-profile-muted">Recent public Feed activity appears on a live profile.</p> : !isFeedEnabled() ? <p className="os-profile-muted">Feed is unavailable on this network.</p> : feed.isLoading ? <p className="os-profile-muted">Loading Feed activity…</p> : feed.isError ? <p className="os-profile-muted">Feed index is unavailable right now.</p> : feedPosts.length ? <ul className="os-profile-activity-list">{feedPosts.map((post) => <li key={String(post.id)}><small>{feedKind === "replies" ? "REPLY" : "POST"} · Memba Feed index · block {String(post.blockH)}</small><p>{post.body.slice(0, 360)}</p><a href={networkPath("os/feed/post/" + String(post.replyTo > 0n ? post.replyTo : post.id))}>Open original thread ↗</a></li>)}</ul> : <p className="os-profile-muted">No {feedKind} in the latest {feed.data?.posts.length ?? 0} indexed activities checked.</p>)}
                {section === "reviews" && (preview ? <p className="os-profile-muted">On-chain reviews appear here after publishing.</p> : reviews.isLoading ? <p className="os-profile-muted">Loading reviews…</p> : reviews.isError ? <p className="os-profile-muted">Reviews are unavailable right now.</p> : reviews.data?.length ? <><ul>{reviews.data.map((review) => <li key={review.id}>{review.rating}/5 · {review.body.slice(0, 240)} <small>· Memba reviews realm</small></li>)}</ul><ReviewsModeration /></> : <p className="os-profile-muted">No public reviews yet.</p>)}
            </section>)}
        </div>
        {tab === "feed" && feed.data && <p className="os-profile-coverage">Showing a recent sample from the Memba Feed index. Older activity may exist.</p>}
        </div>
    </article>
}
