/**
 * The one key `hooks/useNetwork.ts` and Memba OS's shell/network.ts both write
 * before reloading on a network switch, so Shell.tsx can show the "switched to
 * <network>" toast regardless of which surface (a classic page, an OS window)
 * triggered the switch.
 *
 * Lives outside src/os/ on purpose: `hooks/` must never import from `src/os/`
 * (bundle isolation — the flag-off production bundle must not ship OS code),
 * so this tiny shared module is the single source of truth for the key
 * instead of `hooks/useNetwork.ts` importing it from `os/shell/network.ts`.
 */
export const OS_NET_SWITCHED_KEY = "memba_os_net_switched"
