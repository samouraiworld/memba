/**
 * Memba OS kit: the shared building blocks native app windows are built
 * from (sidebar window, table, stat cards, card grid, switch, segmented
 * control, filter chips, pills, gate bar, loading/empty/error states,
 * not-on-mainnet warning). See README.md for when to use each.
 *
 * @module os/kit
 */
export { AppShell, type ShellSection } from "./AppShell"
export { Table, type Column, type TableProps } from "./Table"
export { StatGrid, type Stat } from "./StatGrid"
export { Toggle } from "./Toggle"
export { Loading, Empty, ErrorState } from "./States"
export { NotOnMainnet } from "./NotOnMainnet"
export { Segmented, Chips, type ChoiceOption } from "./Choice"
export { Pill, Gate, type PillTone } from "./Pill"
export { CardGrid, Card } from "./Cards"
