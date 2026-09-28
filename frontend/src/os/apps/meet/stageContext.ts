import { createContext } from "react"

/** The room's visual slot. Shell positions one persistent iframe over it. */
export const MeetStageContext = createContext<(node: HTMLDivElement | null) => void>(() => {})
