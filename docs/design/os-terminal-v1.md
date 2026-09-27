# Memba OS Terminal: public beta proposal

27 September 2026 · owner session #2

## Job

Give builders a useful place inside Memba OS to inspect deployed Gno code and state, write a small realm draft, and learn from PeerDev. A guest can explore and edit. Drafts live in that browser until exported; no source is sent to Memba's backend.

## Window design

- **Explore:** a command history, one prompt, and a persistent rail naming the chain and read mode. Output is literal selectable text. Errors explain the failed query. History and output are bounded.
- **Build draft:** one CodeMirror editor with Go-style highlighting for Gno, a visible realm path, local save status, and `.gno` import/export. A path/package mismatch is shown before export. This tab does not claim to compile or run source.
- **Learn:** its own OS app, opened beside Terminal. A PeerDev playlist loads only after a click, with source chapters linking to the tutorial repository. On a narrow window the video and chapters stack vertically.

The app uses the existing Aqua surface, accent, light/dark text, Manrope chrome and a monospace reading surface. The path and chain are factual navigation aids. Phone layout keeps the prompt and editor full width.

## Release scope

| Stage | Behavior | Acceptance |
|---|---|---|
| Public beta | `help`, `render`, `file`, `funcs`, `balance`, `pkgs`, `clear`; local source draft; Learn | Correct chain, bounded output, guest access, keyboard navigation, light/dark and phone checks, no wallet prompt from a read command |
| Typed transactions | Open the existing Wallet Send and DAO Create flows from relevant tasks | Existing review, network, wallet, fee and unknown-outcome safeguards stay authoritative |
| Dedicated follow-up | Raw `call` and `addpkg`, generic `eval`, local run/test | Separate security and implementation gates below; no claim of availability until verified |

## Why generic execution and signing are gated

`vm/qeval` executes code on an RPC node even when it cannot commit chain state. Client syntax checks do not bound server work; Memba previously removed arbitrary qeval from Explorer (SEC-01). Generic `call` cannot explain an arbitrary realm's effects in the review sheet. Raw `addpkg` needs measured compile, gas, and storage bounds. On `gnoland-1`, a package submission can be stored *inert* awaiting network approval, and may never become live. The editor alone does not run Gno.

Before adding these commands, require a threat model and RPC resource policy for `eval`; a pinned Gno build and measured envelope for a bounded deploy template; namespace and path checks both before review and immediately before signing; exact source hash, fees and storage cap in the review; durable intent and no automatic deploy retry; and status reconciliation through package metadata that distinguishes submitted, inert, live, and unknown.

## Delivery and merge order

Terminal lives in its own `feat/os-terminal-v1` worktree. Guest boundaries, native Feed, and Live activity have merged. This branch includes their current app registry and icons. Run targeted unit and OS browser journeys, frontend build/lint, independent CTO and SWE reviews, and all required CI on the final head. Merge only when the branch is current with `main` and required reviews/checks pass.
