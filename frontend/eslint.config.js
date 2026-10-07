import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Every EVM write goes through lib/chain/evm/send.ts (sendEvmWrite), which binds it to
// its chain and account; nothing else in the app may send one. These rules guard against
// mistakes (a forgotten import, a copied snippet), not a security boundary: code that
// wants to bypass them can.
const EVM_SEND_PATH = 'EVM writes go through sendEvmWrite (lib/chain/evm/send.ts), which binds them to their chain and account.'
const EVM_WRITE_ACTIONS = ['sendTransaction', 'sendTransactionSync', 'writeContract', 'writeContractSync', 'deployContract', 'sendCalls', 'sendCallsSync', 'sendRawTransaction', 'sendRawTransactionSync']

export default defineConfig([
  globalIgnores(['dist', '.release-builds/**', 'test-results-release/**', 'test-results-complete*/**', 'test-results-governance/**', 'src/gen', 'coverage/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // W4 (NEW-FE-7): the compiler-based react-hooks rules are RE-ENABLED —
      // disabled they masked the effect/state bug class that produced the
      // chain-id desync. immutability/preserve-manual-memoization/purity/refs
      // are clean (violations fixed) and enforced. set-state-in-effect still
      // has ~56 legacy occurrences: it stays a WARNING ratchet — visible in
      // every lint run and PR annotation; burn down before flipping to error.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'error',
      'react-hooks/preserve-manual-memoization': 'error',
      'react-hooks/purity': 'error',
      'react-hooks/refs': 'error',
      // Viewport/breakpoint detection must go through the shared useIsMobile()
      // hook (matchMedia, SSR-safe) — not ad-hoc window.innerWidth reads in
      // render, which caused mobile/desktop drift (audit M7).
      'no-restricted-properties': ['error',
        { object: 'window', property: 'innerWidth', message: 'Use the useIsMobile() hook for viewport/breakpoint logic instead of window.innerWidth.' },
        { object: 'window', property: 'innerHeight', message: 'Use the useIsMobile() hook for viewport/breakpoint logic instead of window.innerHeight.' },
      ],
    },
  },
  {
    // JitsiPiPOverlay reads window.innerWidth/innerHeight for drag-bound clamping
    // (pixel geometry, not a breakpoint) — a legitimate, non-drift use.
    files: ['src/components/ui/JitsiPiPOverlay.tsx'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    // BARRICADE 3D renderer (react-three-fiber). Scoped relaxations so the
    // R3F idioms don't fight the repo ratchet: typed uniform bags / shader
    // material definitions need `any`, and scene modules legitimately export
    // helper functions alongside their components (breaks only-export-components).
    // Confined to the lazy render/three subtree; the rest of the app is unchanged.
    files: ['src/games/barricade/render/three/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    ignores: ['src/lib/chain/evm/send.ts', 'src/**/*.test.{ts,tsx,js,jsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: '@wagmi/core', importNames: EVM_WRITE_ACTIONS, message: EVM_SEND_PATH },
          { name: '@wagmi/core/actions', importNames: EVM_WRITE_ACTIONS, message: EVM_SEND_PATH },
          { name: 'viem/actions', importNames: EVM_WRITE_ACTIONS, message: EVM_SEND_PATH },
          { name: 'viem', importNames: ['createWalletClient', ...EVM_WRITE_ACTIONS], message: EVM_SEND_PATH },
        ],
        // Deep paths (e.g. viem/actions/wallet/sendTransaction): no import from them at all.
        patterns: [{ group: ['@wagmi/core/*/**', 'viem/actions/*', 'viem/**/actions/**', 'viem/_*/**'], message: EVM_SEND_PATH }],
      }],
      'no-restricted-syntax': ['error',
        { selector: `CallExpression[callee.property.name=/^(${EVM_WRITE_ACTIONS.join('|')})$/]`, message: EVM_SEND_PATH },
        // A raw provider request that sends: { method: "eth_sendTransaction", … }.
        { selector: 'Property[key.name="method"][value.value=/^(eth_sendTransaction|eth_sendRawTransaction|wallet_sendCalls)$/]', message: EVM_SEND_PATH },
      ],
    },
  },
])
