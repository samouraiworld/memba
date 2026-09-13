# gnoland-1 GovDAO render fixtures

Verbatim `vm/qrender` output from **gnoland-1** mainnet, captured 2026-09-13T10:56:27Z
after confirming `node_info.network == "gnoland-1"` on rpc.gno.land.

| File | Render path |
|---|---|
| `govdao-root.md` | `gno.land/r/gov/dao:` |
| `memberstore-summary.md` | `gno.land/r/gov/dao/memberstore/v0:` |
| `memberstore-members.md` | `gno.land/r/gov/dao/memberstore/v0:members` |

The tier chips are left as full `data:image/svg+xml;base64,…` blobs on purpose:
they are exactly the bytes a loosely written regex could match inside, so a
trimmed fixture would test an easier input than the chain actually sends.

Membership at capture: T1 = 1 member (power 3), T2 = 0, T3 = 0. Re-capture
rather than hand-edit if GovDAO changes — parsers must be proven against the
wire, not against a fixture that was never measured.
