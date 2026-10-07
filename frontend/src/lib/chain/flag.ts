/**
 * The EVM network (Base) is off unless the build sets VITE_ENABLE_EVM="true".
 * The flag is safety-gated (lib/safeFlags.ts): only deploy-previews can turn it on.
 *
 * Every EVM code path is guarded by this constant so a flag-off build folds it
 * to `false` and drops the code (checked by `npm run check:bundle:evm`).
 *
 * @module lib/chain/flag
 */
export const EVM_ENABLED = import.meta.env.VITE_ENABLE_EVM === "true"
