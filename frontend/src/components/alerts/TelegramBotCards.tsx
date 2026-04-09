/**
 * TelegramBotCards — Onboarding cards for Telegram bots.
 *
 * Two cards with deep links to @govdao_activities_bot and @gno_validators_bot.
 * Independent from Discord/Slack — no account linking needed.
 * No auth required to view.
 *
 * @module components/alerts/TelegramBotCards
 */

const cardStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.02)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 12,
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    flex: 1,
    justifyContent: "space-between",
}

const cmdStyle: React.CSSProperties = {
    fontSize: 10, padding: "3px 8px", borderRadius: 4,
    background: "rgba(0,212,170,0.06)",
    color: "var(--color-primary)",
    fontFamily: "JetBrains Mono, monospace",
    display: "inline-block",
}

const btnStyle: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    padding: "8px 16px", borderRadius: 8, border: "none",
    cursor: "pointer", fontFamily: "JetBrains Mono, monospace",
    fontSize: 12, fontWeight: 600,
    background: "#0088cc", color: "#fff",
    textDecoration: "none",
    transition: "opacity 0.2s",
}

interface BotInfo {
    name: string
    handle: string
    link: string
    description: string
    commands: string[]
}

const BOTS: BotInfo[] = [
    {
        name: "GovDAO Activities Bot",
        handle: "@govdao_activities_bot",
        link: "https://t.me/govdao_activities_bot",
        description: "Get notified of new GovDAO proposals, status changes, and executed proposals.",
        commands: ["/status", "/lastproposal", "/executedproposals", "/chain", "/setchain"],
    },
    {
        name: "Validator Monitoring Bot",
        handle: "@gno_validators_bot",
        link: "https://t.me/gno_validators_bot",
        description: "Monitor validator uptime, missed blocks, and get daily reports.",
        commands: ["/status", "/uptime", "/subscribe on all", "/chain", "/setchain", "/report"],
    },
]

export function TelegramBotCards() {
    return (
        <div className="alerts-telegram-grid">
            {BOTS.map(bot => (
                <div key={bot.handle} style={cardStyle}>
                    {/* Header */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 24 }}>✈️</span>
                        <div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text)" }}>
                                {bot.name}
                            </div>
                            <div style={{ fontSize: 11, color: "#0088cc", fontFamily: "JetBrains Mono, monospace" }}>
                                {bot.handle}
                            </div>
                        </div>
                    </div>

                    {/* Description */}
                    <p style={{ fontSize: 11, color: "var(--color-text-secondary)", lineHeight: 1.5, margin: 0 }}>
                        {bot.description}
                    </p>

                    {/* Quick commands */}
                    <div>
                        <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginBottom: 6, fontFamily: "JetBrains Mono, monospace" }}>
                            QUICK COMMANDS
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {bot.commands.map(cmd => (
                                <span key={cmd} style={cmdStyle}>{cmd}</span>
                            ))}
                        </div>
                    </div>

                    {/* CTA */}
                    <a
                        href={bot.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={btnStyle}
                        onMouseOver={e => (e.currentTarget.style.opacity = "0.85")}
                        onMouseOut={e => (e.currentTarget.style.opacity = "1")}
                    >
                        ✈️ Add to Telegram
                    </a>
                </div>
            ))}

            {/* Note */}
            <div style={{
                gridColumn: "1 / -1",
                fontSize: 10, color: "var(--color-text-muted)",
                fontFamily: "JetBrains Mono, monospace",
                padding: "8px 0",
            }}>
                ℹ️ Telegram bots are independent from Discord/Slack webhooks — no account linking required.
                Configure chains and subscriptions directly in the bot chat.
            </div>
        </div>
    )
}
