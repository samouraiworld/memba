import { appSpec, type WindowSpec } from "../shell/windows"

/** A public Feed post requests community-channel membership, not a voting seat. */
export const applyToJoinSpec = (): WindowSpec => appSpec("feed", null, "compose=join")
