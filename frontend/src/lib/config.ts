/**
 * Centralized environment configuration for the Memba frontend.
 * All env vars read from Vite's import.meta.env with sensible defaults.
 */

/** Application version — single source of truth for header/footer badges. */
export const APP_VERSION = "2.0.2"

// Environment-driven config with sensible defaults.

/** Backend API base URL.
 * In dev: empty string → uses Vite proxy.
 * In production: must be set via VITE_API_URL build arg, or falls back to Fly.io. */
export const API_BASE_URL =
    import.meta.env.VITE_API_URL ||
    (import.meta.env.PROD ? "https://memba-backend.fly.dev" : "")

/** Gno chain ID for all RPC calls. */
export const GNO_CHAIN_ID = import.meta.env.VITE_GNO_CHAIN_ID || "portal-loop"

/** Gno RPC endpoint for ABCI queries and broadcasting. */
export const GNO_RPC_URL =
    import.meta.env.VITE_GNO_RPC_URL || "https://rpc.gno.land:443"

/** Bech32 prefix for Gno addresses. */
export const GNO_BECH32_PREFIX = import.meta.env.VITE_GNO_BECH32_PREFIX || "g"

/** Conversion factor: 1 GNOT = 1,000,000 ugnot. */
export const UGNOT_PER_GNOT = 1_000_000
