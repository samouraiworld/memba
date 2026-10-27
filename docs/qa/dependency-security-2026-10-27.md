# Dependency security remediation — 2026-10-27

Base: `97e83c84600521cb3ce81512e40b0fc96e253abc`. This changes dependency manifests and locks; no service configuration or deployment is performed.

## Reproduced advisories

The npm frontend audit found DOMPurify critical/high advisories ([GHSA-cg2g-xh64-v4q7](https://github.com/advisories/GHSA-cg2g-xh64-v4q7), [GHSA-mrv2-3pqr-j5jr](https://github.com/advisories/GHSA-mrv2-3pqr-j5jr)) and undici high ([GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c)). It also found lower-severity advisories in fast-uri, serialize-javascript and the same DOMPurify/undici versions.

The pnpm workspace audit found Zod high ([GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)), body-parser high ([GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828)) and lower-severity fast-uri advisories. These are distinct lockfiles and both require remediation.

| Dependency | Before | After | Scope |
| --- | --- | --- | --- |
| DOMPurify | 3.4.16 | 3.4.17 | Frontend runtime, direct dependency and override |
| undici | 7.29.1 | 7.30.1 | Frontend dev tree, same-major override |
| fast-uri | 3.1.8 | 3.1.9 | Frontend dev tree, v3 floor retained |
| serialize-javascript | 7.0.6 | 7.1.4 | Frontend build tree, v7 override |
| Zod | 3.25.76 | 4.6.7 | MCP server direct dependency |
| body-parser | 2.3.0 | 2.4.0 | MCP SDK → Express, v2-scoped override |
| fast-uri | 4.2.2 | 4.2.3 | MCP SDK → AJV, workspace floor |

Only these targeted versions and body-parser's content-type/iconv-lite dependencies move. SDK 1.32.1, frontend Vite 7.3.7, workspace Vite 8.3.4 and Playwright 1.63.0 remain unchanged.

## Zod migration compatibility

The MCP SDK declares `zod: ^3.25 || ^4.0`. Instead of forcing v4 into a consumer that still declares v3, the server manifest explicitly adopts the patched v4 line. The server uses string, number, enum, default and describe schemas; its production code requires no API changes.

`mcp-server/tests/protocol.test.mjs` starts the actual compiled stdio server and an isolated loopback RPC fixture. It verifies tool discovery and JSON schema output, default realm/path/limit values, a successful tool call using the default DAO, and malformed/missing argument rejection without dispatching an RPC. Workspace CI already builds before running tests, so the new test runs in its existing `pnpm -r test` step.

## Validation

Environment: macOS arm64, Node 22.22.2, npm 10.9.7, pnpm 10.33.0 and the Go 1.26.10 toolchain required by the backend. Playwright is 1.63.0.

- `npm audit --json`: zero advisories in the complete frontend tree after remediation and on the final pre-publication refresh after all suites below.
- `pnpm@10.33.0 audit --json`: zero advisories after remediation and on the final pre-publication refresh.
- Frontend `npm run build` and `npm run lint`: pass.
- Workspace `pnpm -r build` and `pnpm -r test`: pass (29 gno-rpc tests and the MCP protocol test).
- Frontend production/dev audit gates, workspace fail-closed audit gate and its self-tests: pass.
- Full frontend unit run with the pinned environment below: 1,048 files and 12,474 tests pass; the opt-in `regenerate diff_corpus.json` generator is the single skipped file/test. Two additional files could not start a forks worker before Vitest's startup deadline, so the overall invocation exits 1 with two infrastructure errors. Both complete files (`ProProposalVotes.test.tsx`, `os/preferences.test.tsx`) pass when rerun alone with one worker: 2 files, 3 tests, exit 0. Combined coverage is 1,050 passing files / 12,477 passing tests plus the expected generator skip. No test expectation, skip setting or error-ignore flag was changed. This is not reported as an exit-0 full-suite invocation.
- Backend `GOMAXPROCS=2 go test -race -count=1 -p=2 ./...` and `GOMAXPROCS=2 go build -p=2 ./...`: pass across all packages. macOS C/linker warnings from the existing mdbx dependency do not prevent either check.
- Full frontend E2E `CI=true MEMBA_E2E_MAIN_PORT=5273 npx playwright test --reporter=list --workers=2`: exit 0, **650 passed / 14 skipped**, 29.5 minutes, no failed attempt or retry. Projects: Chromium, Firefox, iPhone and Pixel.

The 14 E2E skips are existing test conditions, not exemptions added by this change:

| Reason | Count |
| --- | ---: |
| Visual baselines explicitly disabled with `CI=true` (3 routes × 2 desktop browsers) | 6 |
| GovDAO pagination/EXECUTE canaries without the required proposal data (2 × 2 browsers) | 4 |
| Analytics canary without backend panels (1 × 2 browsers) | 2 |
| Desktop fullscreen deliberately tested only in Chromium | 1 |
| Live Directory RPC smoke deliberately tested only in Chromium | 1 |

The production/dev npm audit gates and the pnpm fail-closed gate were refreshed after E2E and still pass. Dependency installation/resolution was not repeated, and no source or lockfile changed during validation.

Initial concurrent local checks were interrupted after host memory pressure caused widespread timeout failures. The sequential rerun exposed a separate local toolchain mismatch: the global `gno` resolves GNOROOT to an August module (`1c6ac026fb7b`) that cannot import `chain/runtime/unsafe`. A CLI built into a task-specific `/tmp` directory from the existing, clean worktree at CI's exact mainnet pin `31b6650a100d9baf14e7669f8f0df924f1f841e0` resolves that probe. Validation uses this binary and matching GNOROOT, without changing the project's pins or the globally installed toolchain. Incomplete runs are not counted as passing.

### Reproducing the pinned unit-test environment

Run from the Memba repository root, with a local clone of `gnolang/gno` containing the pin. Set the two checkout paths to suitable local locations; the isolated checkout must be a new path. The pin below is the current `GNO_PIN` in `.github/workflows/gno-test.yml`, not a recommendation to move a service runtime.

```sh
memba_gno_pin=31b6650a100d9baf14e7669f8f0df924f1f841e0
memba_gno_source=/path/to/gnolang/gno
memba_gno_checkout=/path/to/new-isolated-gno-checkout
memba_gno_tools="$(mktemp -d)"
git -C "$memba_gno_source" worktree add --detach "$memba_gno_checkout" "$memba_gno_pin"
(
  cd "$memba_gno_checkout"
  GOTOOLCHAIN=go1.26.10 GOMAXPROCS=1 go build -p=1 -mod=readonly \
    -o "$memba_gno_tools/gno" ./gnovm/cmd/gno
)
(
  cd frontend
  PATH="$memba_gno_tools:$PATH" GNOROOT="$memba_gno_checkout" \
    REQUIRE_GNO=1 GNO_REQUIRED_PIN="$memba_gno_pin" GOMAXPROCS=1 \
    npm test -- --run --maxWorkers=2
)
```

`REQUIRE_GNO=1` makes missing or incoherent tooling fail instead of skipping the native proofs. `GNO_REQUIRED_PIN` verifies the source revision used by the DAO proof. This leaves the global `gno` binary and shell configuration untouched.

Audit counts are a dated observation from the npm registry. Later advisory disclosures may require a new remediation even when the committed package versions do not change.
