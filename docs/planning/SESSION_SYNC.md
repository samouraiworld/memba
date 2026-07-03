# SESSION_SYNC — parallel Claude session coordination (append-only; newest on top)

Format: `<UTC time> · <lane> · <wave/item> · START|STOP · files/areas being touched · branch`

Rules:
- Read this file before your first edit of a session; re-read before touching a single-writer file.
- Single-writer files (register here before touching): `api/**` + generated code, `frontend/.env.example`, `CHANGELOG.md`, CI yaml, shared hooks (`useAdena`, tx toolkit).
- Lane C OFF-LIMITS while active (external: #734 / per-sig-verified): `backend/internal/auth/**` (all) · signature RPC handlers in `backend/internal/service/tx_rpc.go` · signature/verified fields in `api/memba/v1/memba.proto` + regenerated code · signing-call paths in `frontend/src/hooks/useAdena.ts` (`SignMultisigTransaction`) — the connection/account-change logic in that file is Lane A; register the split here before either side edits.
- Program reference: `docs/planning/MEMBA_ROADMAP_COMPOUND_2026-07.md`.

---

2026-07-03 · Lane B · W6.3 SEO (PR2: sitemap+robots) · START→STOP (single session) · frontend: lib/sitemap.ts (new), public/robots.txt (new), vite.config.ts (sitemap emit plugin — safeFlags wiring untouched) · feat/w63-sitemap-robots

2026-07-03 · Lane A · W6.3 SEO (PR1: route meta) · START→STOP (single session) · frontend: lib/routeMeta.ts (new), components/layout/RouteMetaSync.tsx (new), Layout.tsx (mount) · feat/w63-seo-route-meta

2026-07-03 · Lane A · W6.2 4-mode IA (PR1: nav shell) · START→STOP (single session) · frontend: navManifest.ts (mode groups), Sidebar.tsx (manifest-driven sections), index.css · feat/w62-ia-nav-modes

2026-07-03 · Lane B · W6.1 changelog automation (PR1+PR2) · START→STOP (single session) · CHANGELOG.md (parse contract), frontend: lib/changelog.ts (new), lib/changelogLegacy.ts (new), pages/Changelogs.tsx · feat/w61-changelog-automation

2026-07-03 · Lane B · W5.6 breaking-changes sweep · START→STOP (single session) · docs only: GNO_CORE_BREAKING_CHANGES.md, roadmap O-7 correction · docs/w56-breaking-changes-sweep

2026-07-03 · Lane A · W5.1 Adena session stability · START→STOP (single session) · frontend: useAdena.ts (connection/persistence paths ONLY — signing paths untouched per Lane C), walletDebug.ts (new) · fix/w51-adena-session-stability

2026-07-03 · Lane A · W5.3 validator review stars · START→STOP (single session) · frontend: ValidatorReviewStars.tsx (new), Validators.tsx, validators.css · feat/w53-validator-review-stars

2026-07-03 · Lane A · W5.2 directory fixes · START→STOP (single session) · frontend: gnowebSource.ts (+RPC qfile path), RealmDetailDrawer.tsx, Directory.tsx, directoryUrl.ts, directory.css, e2e/directory.spec.ts · fix/w52-directory-packages-gnoweb

2026-07-03 · Lane B · program setup · STOP · created roadmap doc + this file · docs/roadmap-compound
