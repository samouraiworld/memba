/**
 * ValueStrip — plain-language on-ramp for first-time visitors (P0-B).
 *
 * The hero sells the vision; this strip answers "what can I actually do here?"
 * in human verbs before the page drops into expert nouns (GovDAO, validators,
 * realm paths). Three cards, each a goal-framed entry point that links to a
 * destination the ShowcaseBoard / nav already expose — no new surface, just a
 * clearer rung on the ladder. Visitor-only (omitted in member mode, where the
 * ActionInbox already answers "what needs me now?").
 *
 * @module components/home/ValueStrip
 */
import { Link } from "react-router-dom"
import { UsersThree, Rocket, Pulse, SquaresFour } from "@phosphor-icons/react"
import { isAppStoreEnabled } from "../../lib/config"
import "./home.css"

export interface ValueStripProps {
    networkKey: string
}

interface ValueCard {
    key: string
    title: string
    sub: string
    href: string
    Icon: typeof UsersThree
}

export function ValueStrip({ networkKey }: ValueStripProps) {
    const cards: ValueCard[] = [
        { key: "vote", title: "Join a community and vote", sub: "find a DAO and have a say", href: `/${networkKey}/dao`, Icon: UsersThree },
        { key: "launch", title: "Launch a token", sub: "create one in minutes", href: `/${networkKey}/tokens`, Icon: Rocket },
        { key: "track", title: "Track the network", sub: "validators, blocks, activity", href: `/${networkKey}/validators`, Icon: Pulse },
        // Flag-gated 4th rung: only offered where the App Store is actually live.
        ...(isAppStoreEnabled()
            ? [{ key: "apps", title: "Explore apps & games", sub: "community apps, on-chain", href: `/${networkKey}/apps`, Icon: SquaresFour }]
            : []),
    ]

    return (
        <section className="value-strip" data-testid="value-strip" aria-label="What you can do here">
            {cards.map(({ key, title, sub, href, Icon }) => (
                <Link key={key} to={href} className="value-strip__card" data-testid={`value-card-${key}`}>
                    <span className="value-strip__icon" aria-hidden="true">
                        <Icon size={20} weight="regular" />
                    </span>
                    <span className="value-strip__body">
                        <span className="value-strip__title">{title}</span>
                        <span className="value-strip__sub">{sub}</span>
                    </span>
                </Link>
            ))}
        </section>
    )
}
