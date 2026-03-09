# v2.0-α — HANDOFF: Plugin Architecture Skeleton

> **Date**: 2026-03-05
> **Branch**: `feat/v2.0-alpha/plugin-architecture`
> **Status**: ✅ Feature complete, all quality gates pass

## What Was Completed

### Plugin Architecture Skeleton (6 new files)

| File | Purpose |
|------|---------|
| `frontend/src/plugins/types.ts` | `PluginManifest` + `PluginProps` interfaces |
| `frontend/src/plugins/registry.ts` | Frozen `BUILT_IN_PLUGINS`, `getPlugins()`, `getPlugin()`, dev-time validation |
| `frontend/src/plugins/PluginLoader.tsx` | Lazy loading + error boundary + shimmer, pre-built wrappers |
| `frontend/src/plugins/proposals/index.tsx` | Placeholder stub proving E2E pipeline |
| `frontend/src/plugins/index.ts` | Barrel export (public API) |
| `frontend/src/plugins/registry.test.ts` | 10 unit tests (100% registry coverage) |

### DAOHome Integration (1 modified file)

- Added `getPlugins` import and "🧩 Extensions" section after Treasury card
- Renders plugin cards with icon, name, description, version badge
- Click navigates to `/dao/:slug/plugin/:pluginId` (future route)
- Defensive: shows nothing if no plugins registered

## Quality Gates

| Gate | Result |
|------|--------|
| Unit tests | 240/240 pass (11 files) |
| TypeScript | 0 errors |
| Lint | 0 errors, 0 warnings |
| Build | 465KB (< 500KB limit) |
| Backend | Clean |

## What Remains (v2.0-α)

1. **Deployment Pipeline** component (`feat/v2.0-alpha/deployment-pipeline`)
2. **Member Proposals** — Add/Remove/AssignRole (`feat/v2.0-alpha/member-proposals`)
3. Plugin route in `App.tsx` (will be added when plugins have real content)

## Gotchas / Learnings

- **ESLint `react-hooks/static-components`** is extremely strict. Even `Map.get()` or `useMemo` in a render body is flagged as "component created during render". Solution: pre-build all wrapper components at module level via `LOADER_COMPONENTS` Record.
- **Proposals plugin generates a separate Vite chunk** (`index-CdrXJacS.js`, 0.98KB) — confirms lazy loading works correctly.
