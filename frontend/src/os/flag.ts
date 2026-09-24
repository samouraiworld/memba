/** Memba OS is off unless the build sets VITE_MEMBA_OS="true" (see osBuildGate.ts). */
export const OS_ENABLED = import.meta.env.VITE_MEMBA_OS === "true"
