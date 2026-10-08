/**
 * Stands in for `node-fetch` in EVM builds (vite.config.ts alias). api-kit
 * imports node-fetch only where there is no `window` (Node) and uses
 * `window.fetch` in the browser, but the bundler would still ship node-fetch
 * and its Node HTTP stack (~300 KB) as a precached chunk.
 *
 * @module lib/chain/evm/safe/nodeFetch.browser
 */
const browserFetch: typeof fetch = (...args) => fetch(...args)

export default browserFetch
