import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'src/gen']),
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
])
