import { joinFeedSpec, type WindowSpec } from "../shell/windows"

/** Keep an open Feed thread (and its unsent reply) intact when applying. */
export const applyToJoinSpec = (): WindowSpec => joinFeedSpec()
