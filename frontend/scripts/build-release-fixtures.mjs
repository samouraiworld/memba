// Two real production outputs, with distinct entry/chunk hashes, on one origin.
import { build } from 'vite'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
delete process.env.SENTRY_AUTH_TOKEN
Object.assign(process.env, {
    VITE_GNO_CHAIN_ID: 'mainnet', VITE_ENABLE_PRO_APP: 'true',
    VITE_ENABLE_TREASURY_SPEND: 'false', VITE_ENABLE_AGENT_CREDITS: 'false',
    VITE_SENTRY_DSN: '', VITE_CLERK_PUBLISHABLE_KEY: '',
})
rmSync('.release-builds', { recursive: true, force: true })
for (const release of ['a', 'b']) {
    await build({
        define: { __APP_VERSION__: JSON.stringify(`7.7.0-release-${release}`) },
        build: { outDir: resolve(`.release-builds/${release}`), sourcemap: false },
    })
}
