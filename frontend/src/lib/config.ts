/**
 * Centralized environment configuration for the Memba frontend.
 * All env vars read from Vite's import.meta.env with sensible defaults.
 */

/** Application version — single source of truth for header/footer badges. */
export const APP_VERSION = "2.0.1"

// Environment-driven config with sensible defaults.

/** Backend API base URL. Falls back to empty string (uses vite proxy in dev). */
export const API_BASE_URL = import.meta.env.VITE_API_URL || ""

/** Gno chain ID for all RPC calls. */
export const GNO_CHAIN_ID = import.meta.env.VITE_GNO_CHAIN_ID || "test11"

/** Gno RPC endpoint for ABCI queries and broadcasting. */
export const GNO_RPC_URL =
    import.meta.env.VITE_GNO_RPC_URL || "https://rpc.test11.testnets.gno.land:443"

/** Bech32 prefix for Gno addresses. */
export const GNO_BECH32_PREFIX = import.meta.env.VITE_GNO_BECH32_PREFIX || "g"

/** Conversion factor: 1 GNOT = 1,000,000 ugnot. */
export const UGNOT_PER_GNOT = 1_000_000
