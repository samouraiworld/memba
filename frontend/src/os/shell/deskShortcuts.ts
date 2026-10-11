/**
 * The shell's desk, offered to app windows so they can place and remove their
 * own shortcuts through the same store as the menu bar's "Add to Desktop".
 *
 * @module os/shell/deskShortcuts
 */
import { createContext, useContext } from "react"
import type { DeskItem } from "./desk"

export type DeskPin = Pick<DeskItem, "ty" | "ref">

export interface DeskShortcuts {
    isPinned(item: DeskPin): boolean
    pin(item: DeskPin): void
    unpin(item: DeskPin): void
}

/** Provided by the shell around every window; null outside Memba OS. */
export const DeskShortcutsContext = createContext<DeskShortcuts | null>(null)

export function useDeskShortcuts(): DeskShortcuts | null {
    return useContext(DeskShortcutsContext)
}
