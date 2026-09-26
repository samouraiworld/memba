import { appSpec, type WindowSpec } from "../shell/windows"

/** Keep an open Feed thread (and its unsent reply) intact when applying. */
export const applyToJoinSpec = (): WindowSpec => ({
    ...appSpec("feed", null, "compose=join"),
    key: "flow:feed-join",
    title: "Join community · Feed",
})
