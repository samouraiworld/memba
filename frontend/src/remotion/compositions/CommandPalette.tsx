/**
 * CommandPalette — 6s animated Cmd+K search demo.
 *
 * Matches real CommandPalette.tsx: ⌘ icon input, section grouping,
 * cmd-palette-item layout, footer keybinds. Uses real COMMANDS data.
 */
import { useCurrentFrame, spring, interpolate, useVideoConfig } from "remotion"
import { MockUI } from "../components/MockUI"
import { COLORS, fontMono, fontSans } from "../components/tokens"
import { TypewriterText } from "../components/TypewriterText"

// Real commands from commands.ts (subset for compact display)
const COMMANDS = [
    { icon: "🏛️", label: "My DAOs", section: "DAO" },
    { icon: "➕", label: "Create DAO", section: "DAO" },
    { icon: "🪙", label: "Token Launchpad", section: "Tokens" },
    { icon: "💎", label: "Create Token", section: "Tokens" },
    { icon: "🔐", label: "Multisig Hub", section: "Multisig" },
    { icon: "📊", label: "Dashboard", section: "Navigation" },
    { icon: "⚡", label: "Validators", section: "Explore" },
]

export function CommandPalette() {
    const frame = useCurrentFrame()
    const { fps } = useVideoConfig()

    // Timeline: 0-30 shortcut hint, 30-50 palette opens, 50-110 typing "create", 110-180 selection
    const paletteOpen = frame > 30
    const paletteAppear = spring({ frame: frame - 30, fps, config: { damping: 12 } })

    // Fuzzy filter "create"
    const searchText = "create"
    const typedChars = interpolate(frame, [50, 50 + searchText.length * 4], [0, searchText.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    const currentSearch = searchText.slice(0, Math.floor(typedChars)).toLowerCase()

    const filtered = currentSearch.length > 0
        ? COMMANDS.filter(c => c.label.toLowerCase().includes(currentSearch))
        : COMMANDS

    // Group by section (matches real CommandPalette.tsx)
    const sections = new Map<string, typeof COMMANDS>()
    for (const cmd of filtered) {
        const list = sections.get(cmd.section) || []
        list.push(cmd)
        sections.set(cmd.section, list)
    }

    const selectionFrame = 130
    const selected = frame > selectionFrame ? 0 : -1

    return (
        <MockUI title="Memba">
            {/* Shortcut hint — before palette opens */}
            {!paletteOpen && (
                <div style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flex: 1, gap: 6,
                }}>
                    <span style={{ fontSize: 9, color: COLORS.muted, fontFamily: fontSans }}>Press</span>
                    <span style={{
                        fontSize: 9, fontFamily: fontMono, color: COLORS.text,
                        background: "#0c0c0c", border: "1px solid #222",
                        padding: "2px 6px", borderRadius: 3,
                    }}>
                        ⌘K
                    </span>
                    <span style={{ fontSize: 9, color: COLORS.muted, fontFamily: fontSans }}>to navigate</span>
                </div>
            )}

            {/* Palette — matches cmd-palette class structure */}
            {paletteOpen && (
                <div style={{
                    opacity: paletteAppear,
                    transform: `scale(${0.96 + paletteAppear * 0.04})`,
                    background: "#0a0a0a",
                    border: "1px solid #222",
                    borderRadius: 8,
                    overflow: "hidden",
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                }}>
                    {/* Input — matches cmd-palette-input-wrap */}
                    <div style={{
                        padding: "6px 10px",
                        borderBottom: "1px solid #222",
                        display: "flex", alignItems: "center", gap: 6,
                    }}>
                        {/* ⌘ icon — matches cmd-palette-icon */}
                        <span style={{ fontSize: 10, color: COLORS.muted }}>⌘</span>
                        <TypewriterText
                            text={searchText}
                            startFrame={50}
                            speed={4}
                            style={{ fontSize: 9, fontFamily: fontMono, color: COLORS.text }}
                        />
                        {/* esc kbd — matches cmd-palette-kbd */}
                        <span style={{
                            marginLeft: "auto",
                            fontSize: 6, fontFamily: fontMono, color: COLORS.muted,
                            background: "#0c0c0c", border: "1px solid #333",
                            padding: "1px 4px", borderRadius: 2,
                        }}>
                            esc
                        </span>
                    </div>

                    {/* Results — grouped by section like real component */}
                    <div style={{ padding: 3, display: "flex", flexDirection: "column", gap: 1, flex: 1, overflow: "hidden" }}>
                        {Array.from(sections.entries()).map(([section, cmds]) => {
                            return (
                                <div key={section}>
                                    {/* Section header — matches cmd-palette-section */}
                                    <div style={{
                                        fontSize: 6, fontFamily: fontMono, color: COLORS.muted,
                                        textTransform: "uppercase", letterSpacing: "0.06em",
                                        padding: "3px 8px",
                                    }}>
                                        {section}
                                    </div>
                                    {cmds.map((cmd) => {
                                        const globalIdx = filtered.indexOf(cmd)
                                        const isSelected = selected === globalIdx
                                        return (
                                            <div
                                                key={cmd.label}
                                                style={{
                                                    display: "flex", alignItems: "center", gap: 6,
                                                    padding: "4px 8px", borderRadius: 4,
                                                    background: isSelected ? "rgba(0,212,170,0.08)" : "transparent",
                                                    opacity: spring({ frame: frame - 30 - globalIdx * 3, fps, config: { damping: 15 } }),
                                                }}
                                            >
                                                <span style={{ fontSize: 10 }}>{cmd.icon}</span>
                                                <span style={{
                                                    fontSize: 8, fontFamily: fontSans,
                                                    color: isSelected ? COLORS.accent : COLORS.text,
                                                    fontWeight: isSelected ? 600 : 400,
                                                }}>
                                                    {cmd.label}
                                                </span>
                                            </div>
                                        )
                                    })}
                                </div>
                            )
                        })}
                    </div>

                    {/* Footer — matches cmd-palette-footer with kbd elements */}
                    <div style={{
                        borderTop: "1px solid #222",
                        padding: "3px 10px", display: "flex", gap: 8,
                    }}>
                        {[
                            { kbd: "↑↓", label: "navigate" },
                            { kbd: "↵", label: "select" },
                            { kbd: "esc", label: "close" },
                        ].map(h => (
                            <span key={h.kbd} style={{ fontSize: 6, fontFamily: fontMono, color: COLORS.muted, display: "flex", alignItems: "center", gap: 2 }}>
                                <span style={{
                                    background: "#0c0c0c", border: "1px solid #333",
                                    padding: "0px 3px", borderRadius: 2, fontSize: 6,
                                }}>
                                    {h.kbd}
                                </span>
                                {h.label}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </MockUI>
    )
}
