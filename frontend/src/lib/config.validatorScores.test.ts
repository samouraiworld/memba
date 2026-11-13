import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { NETWORKS, VALIDATOR_SCORES_MAINNET_PATH, VALIDATOR_SCORES_REALM, validatorScoresRealmFor } from "./config"

const here = dirname(fileURLToPath(import.meta.url))

describe("validator selection scores realm per network", () => {
    it("names the samcrew realm", () => {
        expect(VALIDATOR_SCORES_REALM).toBe("gno.land/r/samcrew/validator_scores")
    })

    it("reads the deployed mainnet realm after its first edition is sealed", () => {
        expect(VALIDATOR_SCORES_MAINNET_PATH).toBe(VALIDATOR_SCORES_REALM)
        expect(validatorScoresRealmFor("mainnet")).toBe(VALIDATOR_SCORES_REALM)
    })

    it("is hidden on every other network, and on keys every object inherits", () => {
        for (const key of ["onyx", "test13", "local", "pearl", "constructor", "toString", ""]) {
            expect(validatorScoresRealmFor(key), key).toBeNull()
        }
    })

    it("pins the enabled mainnet realm to its verified deployment receipt", () => {
        const records = (JSON.parse(readFileSync(resolve(here, "../../../realm-versions.json"), "utf8")) as Record<string, Record<string, unknown>>).mainnet
        expect(records.validator_scores).toMatchObject({
            path: VALIDATOR_SCORES_MAINNET_PATH,
            height: 1262913,
            txHash: "5l+PywUpqjos/027lxx5teKshGme6SBeWyjDGMU+czE=",
            verifiedVia: "vm/qfile",
            fileCount: 7,
        })
    })

    it("has no local network in unit tests", () => {
        expect(Object.hasOwn(NETWORKS, "local")).toBe(false)
    })
})

describe("the dev-only local network in config", () => {
    afterEach(() => {
        vi.unstubAllEnvs()
        vi.resetModules()
    })

    // config.ts evaluates the flag once, at module load: re-evaluate it per case.
    async function loadConfig(env: { DEV: boolean; MODE: string; flag: string }) {
        vi.resetModules()
        vi.stubEnv("DEV", env.DEV)
        vi.stubEnv("MODE", env.MODE)
        vi.stubEnv("VITE_ENABLE_LOCAL_NETWORK", env.flag)
        return import("./config")
    }

    it("exists on the dev server with the flag: gnodev's node, visible, carrying the scores realm", async () => {
        const config = await loadConfig({ DEV: true, MODE: "development", flag: "true" })
        expect(config.LOCAL_NETWORK_ENABLED).toBe(true)
        expect(config.NETWORKS.local).toMatchObject({
            chainId: "dev",
            rpcUrl: "http://localhost:26657",
            fallbackRpcUrls: [],
            explorerUrl: "http://localhost:8888",
            isTestnet: true,
            realmsDeployed: false,
            faucetUrl: "",
        })
        expect(config.NETWORKS.local.hidden).toBeUndefined()
        expect(Object.hasOwn(config.VISIBLE_NETWORKS, "local")).toBe(true)
        expect(config.isTrustedRpcDomain("http://localhost:26657")).toBe(true)
        expect(config.validatorScoresRealmFor("local")).toBe("gno.land/r/samcrew/validator_scores")
        // Mainnet activation is independent of the local development flag.
        expect(config.validatorScoresRealmFor("mainnet")).toBe(config.VALIDATOR_SCORES_REALM)
    })

    it("is absent from production builds, from unit tests and without the flag", async () => {
        for (const env of [
            { DEV: false, MODE: "production", flag: "true" },
            { DEV: true, MODE: "test", flag: "true" },
            { DEV: true, MODE: "development", flag: "" },
            { DEV: true, MODE: "development", flag: "TRUE" },
        ]) {
            const config = await loadConfig(env)
            expect(Object.hasOwn(config.NETWORKS, "local"), JSON.stringify(env)).toBe(false)
            expect(config.validatorScoresRealmFor("local"), JSON.stringify(env)).toBeNull()
        }
    })
})
