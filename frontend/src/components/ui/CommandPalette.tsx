/**
 * CommandPalette — Cmd+K navigation shortcut.
 *
 * Opens a search modal with fuzzy-find navigation to all app pages.
 * Keyboard accessible: arrow keys to navigate, enter to select, esc to close.
 *
 * Usage: Add <CommandPalette /> to Layout component.
 */
import { useNetworkNav } from "../../hooks/useNetworkNav"
import { useState, useEffect, useRef, useCallback } from "react"
import "./command-palette.css"

// ── Command definitions ───────────────────────────────────────

import { COMMANDS, type Command } from "./commands"
import { completeQuest } from "../../lib/quests"
import { toggleTheme } from "../../lib/themeStore"

// ── Fuzzy search ──────────────────────────────────────────────

function fuzzyMatch(query: string, command: Command): boolean {
    const q = query.toLowerCase()
    const targets = [command.label, command.section, ...(command.keywords || [])]
    return targets.some(t => t.toLowerCase().includes(q))
}

// ── Component ─────────────────────────────────────────────────

export function CommandPalette() {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState("")
    const [selectedIndex, setSelectedIndex] = useState(0)
    const inputRef = useRef<HTMLInputElement>(null)
    const navigate = useNetworkNav()

    const filtered = query.trim()
        ? COMMANDS.filter(c => fuzzyMatch(query, c))
        : COMMANDS

    // ── Keyboard shortcut: Cmd+K / Ctrl+K ─────────────────
    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            if ((e.metaKey || e.ctrlKey) && e.key === "k") {
                e.preventDefault()
                setOpen(prev => !prev)
            }
        }
        document.addEventListener("keydown", handleKeyDown)
        return () => document.removeEventListener("keydown", handleKeyDown)
    }, [])

    // Auto-focus input when opened
    useEffect(() => {
        if (open) {
            setQuery("")
            setSelectedIndex(0)
            setTimeout(() => inputRef.current?.focus(), 50)
        }
    }, [open])

    // Reset selection when query changes
    useEffect(() => {
        setSelectedIndex(0)
    }, [query])

    const handleSelect = useCallback((command: Command) => {
        completeQuest("use-cmdk")
        if (command.id === "toggle-theme") {
            toggleTheme()
        }
        if (command.action) {
            command.action()
        }
        if (command.path) {
            navigate(command.path)
        }
        setOpen(false)
    }, [navigate])

    // ── Internal keyboard navigation ──────────────────────
    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === "ArrowDown") {
            e.preventDefault()
            setSelectedIndex(i => Math.min(i + 1, filtered.length - 1))
        } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setSelectedIndex(i => Math.max(i - 1, 0))
        } else if (e.key === "Enter" && filtered[selectedIndex]) {
            e.preventDefault()
            handleSelect(filtered[selectedIndex])
        } else if (e.key === "Escape") {
            setOpen(false)
        }
    }

    if (!open) return null

    // Group commands by section
    const sections = new Map<string, Command[]>()
    for (const cmd of filtered) {
        const list = sections.get(cmd.section) || []
        list.push(cmd)
        sections.set(cmd.section, list)
    }

    let globalIndex = 0

    return (
        <>
            <div className="cmd-palette-backdrop" onClick={() => setOpen(false)} />
            <div className="cmd-palette" role="dialog" aria-label="Command palette">
                <div className="cmd-palette-input-wrap">
                    <span className="cmd-palette-icon">⌘</span>
                    <input
                        ref={inputRef}
                        id="command-palette-input"
                        type="text"
                        className="cmd-palette-input"
                        placeholder="Type a command…"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        autoComplete="off"
                        spellCheck={false}
                    />
                    <kbd className="cmd-palette-kbd">esc</kbd>
                </div>

                <div className="cmd-palette-results">
                    {filtered.length === 0 && (
                        <div className="cmd-palette-empty">No results found</div>
                    )}
                    {Array.from(sections.entries()).map(([section, commands]) => (
                        <div key={section}>
                            <div className="cmd-palette-section">{section}</div>
                            {commands.map(cmd => {
                                const idx = globalIndex++
                                return (
                                    <button
                                        key={cmd.id}
                                        className={`cmd-palette-item ${idx === selectedIndex ? "selected" : ""}`}
                                        onClick={() => handleSelect(cmd)}
                                        onMouseEnter={() => setSelectedIndex(idx)}
                                    >
                                        <span className="cmd-palette-item-icon">{cmd.icon}</span>
                                        <span className="cmd-palette-item-label">{cmd.label}</span>
                                    </button>
                                )
                            })}
                        </div>
                    ))}
                </div>

                <div className="cmd-palette-footer">
                    <span><kbd>↑↓</kbd> navigate</span>
                    <span><kbd>↵</kbd> select</span>
                    <span><kbd>esc</kbd> close</span>
                </div>
            </div>
        </>
    )
}
