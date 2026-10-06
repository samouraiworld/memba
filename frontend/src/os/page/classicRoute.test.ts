import { describe, expect, it } from "vitest"
import { resolveNetworkKey, retiredNetworkSuccessor } from "../../lib/config"
import { OS_APPS } from "../apps"
import { parseOsPath } from "../shell/osPath"
import { specForTarget, urlForWindow } from "../shell/windows"
import { classicForSection, classicHome, matchRoute, osTargetForClassic, osUrlForClassic, pageNeedsWallet, sectionForClassic } from "./classicRoute"

const ADDR = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"

describe("matchRoute", () => {
    it("matches params and trailing splats like the route table", () => {
        expect(matchRoute("feed/post/:id", "feed/post/12")).toBe(true)
        expect(matchRoute("feed/post/:id", "feed/post")).toBe(false)
        expect(matchRoute("apps/*", "apps")).toBe(true)
        expect(matchRoute("apps/*", "apps/x/y")).toBe(true)
        expect(matchRoute("validators", "validators/x")).toBe(false)
    })
})

describe("sections", () => {
    it("drop the app's first segment when that round-trips", () => {
        expect(sectionForClassic("feed", "feed/post/12")).toBe("post/12")
        expect(sectionForClassic("validators", `validators/${ADDR}`)).toBe(ADDR)
        expect(sectionForClassic("store", "apps/submit")).toBe("submit")
        expect(sectionForClassic("devreport", "gnolove/teams")).toBe("teams")
    })

    it("keep the classic path when dropping would land on another page", () => {
        expect(sectionForClassic("validators", "alerts")).toBe("alerts")
        expect(sectionForClassic("quests", "quests/points")).toBe("quests/points")
        expect(sectionForClassic("multisig", "create")).toBe("create")
    })

    it("are null for the app's home", () => {
        expect(sectionForClassic("feed", "feed")).toBeNull()
        expect(classicHome("store")).toBe("apps")
        expect(classicHome("wallet")).toBe("")
        expect(classicHome("terminal")).toBeNull()
    })

    it("gives Market the classic marketplace page as its home, and round-trips a services section", () => {
        expect(classicForSection("market", null)).toBe("marketplace")
        expect(classicForSection("market", "services")).toBe("services")
        expect(sectionForClassic("market", "services")).toBe("services")
    })

    it("round-trip every static route of every app", () => {
        for (const app of OS_APPS) {
            for (const route of app.routes) {
                const page = route.replace(/\/\*$/, "/x").replace(/:[A-Za-z]+/g, "p1")
                expect(classicForSection(app.id, sectionForClassic(app.id, page)), `${app.id} ${page}`).toBe(page === classicHome(app.id) ? classicHome(app.id) : page)
            }
        }
    })

    it("refuse a section that isn't one of the app's pages", () => {
        expect(classicForSection("feed", "nope/nope")).toBeNull()
    })
})

describe("osTargetForClassic", () => {
    it("maps pages to their app window, with a URL that parses back", () => {
        const t = osTargetForClassic("/mainnet/feed/post/12", "mainnet")!
        expect(t).toEqual({ kind: "app", app: "feed", section: "post/12" })
        const url = urlForWindow(specForTarget(t)!)
        expect(url).toBe("/os/feed/post/12")
        expect(parseOsPath(url)).toEqual(t)
    })

    it("sends DAO pages to the native DAO windows", () => {
        expect(osTargetForClassic("/mainnet/dao/gno.land/r/gov/dao", "mainnet")).toEqual({ kind: "dao", name: "govdao", section: "overview" })
        expect(osTargetForClassic("/mainnet/dao/gno.land/r/alice/team/proposal/7", "mainnet")).toEqual({ kind: "proposal", dao: "alice.team", n: 7 })
        expect(osTargetForClassic("/mainnet/dao/gno.land/r/alice/team/propose", "mainnet")).toEqual({ kind: "new-proposal", dao: "alice.team" })
        expect(osTargetForClassic("/mainnet/dao/create", "mainnet")).toEqual({ kind: "app", app: "daos", section: "new" })
        // A weighted DAO's classic page is its DAO folder, not a page in the DAOs window.
        expect(osTargetForClassic("/mainnet/weighted-dao/gno.land/r/samcrew/memba_dao", "mainnet")).toEqual({ kind: "dao", name: "memba_dao", section: "overview" })
    })

    it("maps a multisig page to the multisig window, and its other pages to the app", () => {
        expect(osTargetForClassic(`/mainnet/multisig/${ADDR}`, "mainnet")).toEqual({ kind: "multisig", address: ADDR })
        const propose = osTargetForClassic(`/mainnet/multisig/${ADDR}/propose`, "mainnet")!
        expect(propose).toEqual({ kind: "app", app: "multisig", section: `${ADDR}/propose` })
        expect(parseOsPath(urlForWindow(specForTarget(propose)!))).toEqual(propose)
    })

    it("maps the home page to Wallet, keeps the page's query, and refuses other networks and unknown pages", () => {
        expect(osTargetForClassic("/mainnet/", "mainnet")).toEqual({ kind: "app", app: "wallet", section: null })
        expect(osTargetForClassic("/mainnet/tx/5?ms=g1", "mainnet")).toEqual({ kind: "app", app: "wallet", section: "tx/5", query: "ms=g1" })
        expect(osTargetForClassic("/betanet/feed", "mainnet")).toBeNull()
        expect(osTargetForClassic("/mainnet/github/callback", "mainnet")).toBeNull()
        expect(osTargetForClassic("/mainnet/feedback", "mainnet")).toEqual({ kind: "feedback" })
    })

    it("sends the classic dashboard and home to the desktop", () => {
        expect(osTargetForClassic("/mainnet/dashboard", "mainnet")).toEqual({ kind: "desktop" })
        expect(osTargetForClassic("/", "mainnet")).toEqual({ kind: "desktop" })
        expect(osTargetForClassic("/mainnet/dashboard/extra", "mainnet")).not.toEqual({ kind: "desktop" })
    })

    it("gives a bare legacy path the current network, as LegacyRedirect does", () => {
        expect(osTargetForClassic("/validators/hacker", "mainnet")).toEqual({ kind: "app", app: "validators", section: "hacker" })
        expect(osTargetForClassic("/os/feed", "mainnet")).toBeNull()
    })

    it("keeps a page's query string with its window target", () => {
        expect(osTargetForClassic("/mainnet/validators?tab=alerts", "mainnet")).toEqual({ kind: "app", app: "validators", section: null, query: "tab=alerts" })
        expect(osTargetForClassic("/mainnet/directory?tab=tokens#top", "mainnet")).toEqual({ kind: "app", app: "explorer", section: null, query: "tab=tokens" })
        expect(osTargetForClassic("/mainnet/validators", "mainnet")).toStrictEqual({ kind: "app", app: "validators", section: null })
        // DAO windows are native: a query means nothing to them.
        expect(osTargetForClassic("/mainnet/dao/gno.land/r/gov/dao?x=1", "mainnet")).toEqual({ kind: "dao", name: "govdao", section: "overview" })
    })
})

describe("pageNeedsWallet", () => {
    it("covers the pages that send guests away in the classic app", () => {
        expect(["profile", "multisig"].every(pageNeedsWallet)).toBe(true)
        // Native App Store sections: the store window serves guests itself.
        expect(["apps/submit", "apps/review", "apps/my-submissions"].some(pageNeedsWallet)).toBe(false)
        expect(["feed", "validators", "profile/g1x", "apps", "apps/gno.land/r/alice/example"].some(pageNeedsWallet)).toBe(false)
    })

    it("lets a guest open the multisig forms, which carry their own connect prompt and a disabled submit", () => {
        expect(["create", "import", `multisig/${ADDR}`, `multisig/${ADDR}/propose`].some(pageNeedsWallet)).toBe(false)
    })
})

// The redirect map of memba.samourai.app's retirement: a classic URL on memba.club opens its window.
// Each row resolves the network as a cold page load does (the URL first, a retired one to its successor).
describe("osUrlForClassic", () => {
    const table: [string, string | null][] = [
        ["/mainnet", "/os"],
        ["/mainnet/", "/os"],
        ["/mainnet//", "/os"],
        ["/mainnet/?ref=x", "/os"],
        ["/mainnet/dashboard", "/os"],
        ["/mainnet/dao", "/os/daos"],
        ["/mainnet/dao/create", "/os/daos/new"],
        ["/mainnet/dao/gno.land/r/alice/team", "/os/dao/alice.team"],
        ["/mainnet/dao/gno.land/r/alice/team/members", "/os/dao/alice.team/members"],
        ["/mainnet/dao/gno.land/r/alice/team/treasury", "/os/dao/alice.team/treasury"],
        ["/mainnet/dao/gno.land/r/alice/team/proposals", "/os/dao/alice.team/proposals"],
        ["/mainnet/dao/gno.land/r/samcrew/memba_dao/proposals/3", "/os/dao/memba_dao/proposals/3"],
        ["/mainnet/dao/gno.land/r/gov/dao/proposal/3", "/os/dao/govdao/proposals/3"],
        ["/mainnet/dao/gno.land/r/alice/team/propose", "/os/dao/alice.team/proposals/new"],
        // Pages the DAO windows don't have open as themselves in a DAOs window.
        ["/mainnet/dao/gno.land/r/alice/team/settings", "/os/daos/dao/gno.land/r/alice/team/settings"],
        ["/mainnet/dao/gno.land/r/alice/team/channels", "/os/daos/dao/gno.land/r/alice/team/channels"],
        ["/mainnet/dao/gno.land/r/alice/team/plugin/board", "/os/daos/dao/gno.land/r/alice/team/plugin/board"],
        ["/mainnet/dao/gno.land~r~alice~team/settings", "/os/daos/dao/gno.land/r/alice/team/settings"],
        ["/mainnet/weighted-dao/gno.land/r/alice/team/proposals", "/os/dao/alice.team/proposals"],
        // A weighted DAO's other classic pages are its folder.
        ["/mainnet/weighted-dao/gno.land/r/alice/team/settings", "/os/dao/alice.team"],
        ["/mainnet/organizations", "/os/daos/organizations"],
        ["/mainnet/candidature", "/os/daos/candidature"],
        ["/mainnet/multisig", "/os/multisig"],
        ["/mainnet/create", "/os/multisig/create"],
        ["/mainnet/import", "/os/multisig/import"],
        [`/mainnet/multisig/${ADDR}`, `/os/multisig/${ADDR}`],
        [`/mainnet/multisig/${ADDR}/propose`, `/os/multisig/${ADDR}/propose`],
        ["/mainnet/tx/42", "/os/wallet/tx/42"],
        ["/mainnet/feed", "/os/feed"],
        ["/mainnet/feed/post/12?x=1", "/os/feed/post/12?x=1"],
        [`/mainnet/feed/user/${ADDR}`, `/os/feed/user/${ADDR}`],
        ["/mainnet/apps", "/os/store"],
        ["/mainnet/apps/submit", "/os/store/submit"],
        ["/mainnet/extensions", "/os/store/extensions"],
        ["/mainnet/game", "/os/arcade"],
        ["/mainnet/game/barricade", "/os/arcade/barricade"],
        ["/mainnet/validators", "/os/validators"],
        ["/mainnet/validators/hacker", "/os/validators/hacker"],
        [`/mainnet/validators/${ADDR}`, `/os/validators/${ADDR}`],
        ["/mainnet/alerts", "/os/validators/alerts"],
        ["/mainnet/settings", "/os/settings"],
        ["/mainnet/tokens", "/os/tokens"],
        ["/mainnet/tokens/ABC", "/os/tokens/ABC"],
        ["/mainnet/create-token", "/os/tokens/create-token"],
        ["/mainnet/nft", "/os/nft"],
        ["/mainnet/marketplace", "/os/market"],
        ["/mainnet/services", "/os/market/services"],
        ["/mainnet/quests", "/os/quests"],
        ["/mainnet/leaderboard", "/os/quests/leaderboard"],
        ["/mainnet/directory", "/os/explorer"],
        [`/mainnet/profile/${ADDR}`, `/os/profile/${ADDR}`],
        ["/mainnet/u/alice", "/os/profile/u/alice"],
        ["/mainnet/blog", "/os/news"],
        ["/mainnet/blog/why-memba", "/os/news/why-memba"],
        ["/mainnet/changelogs", "/os/news/changelogs"],
        ["/mainnet/gnolove", "/os/dev-report"],
        ["/mainnet/feedback", "/os/feedback"],
        // A bare legacy path gets the current network.
        ["/feed/post/12", "/os/feed/post/12"],
        // A retired network: the classic page redirects to its successor first, then that URL opens its window.
        ["/pearl/dao", null],
        ["/pearl/feed/post/12", null],
        ["/topaz/dao", null],
        ["/sapphire/feed", null],
        ["/gnoland1/validators", null],
        // No window: the classic page stays.
        ["/github/callback?code=a&state=b", null],
        ["/mainnet/github/callback?code=a&state=b", null],
        ["/mainnet/marketplace-v2-preview", null],
        ["/mainnet/dao/not-a-realm", null],
        ["/mainnet/no-such-page", null],
        // Networks hidden from the selector stay classic: Memba OS would not stay on them.
        ["/test13/dao", null],
        ["/onyx/feed", null],
    ]
    const resolve = (classic: string) => osUrlForClassic(classic, resolveNetworkKey({ pathname: classic }))

    it.each(table)("%s → %s", (classic, os) => {
        expect(resolve(classic)).toBe(os)
    })

    it("opens a URL the OS reads back as the same window", () => {
        for (const [classic, os] of table) {
            if (!os) continue
            expect(urlForWindow({ target: parseOsPath(os.split("?")[0]) }), classic).toBe(os.split("?")[0])
        }
    })

    it("follows a retired network's redirect in two hops", () => {
        for (const retired of ["pearl", "topaz", "sapphire", "gnoland1"]) {
            expect(resolve(`/${retired}/feed/post/12`), retired).toBeNull()
            expect(resolve(`/${retiredNetworkSuccessor(retired)}/feed/post/12`), retired).toBe("/os/feed/post/12")
        }
    })
})
