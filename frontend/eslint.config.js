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
      // Temporarily disable the new compiler-based rules introduced in eslint-plugin-react-hooks@5.2.0
      // There are 70+ occurrences in the codebase that need to be refactored eventually.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
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
