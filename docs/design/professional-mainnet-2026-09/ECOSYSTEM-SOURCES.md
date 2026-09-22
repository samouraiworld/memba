# App Store ecosystem directory

Checked 2026-09-22. These seven editorial projects are separate from on-chain listings, review scores and Memba realm eligibility. External links open in a new tab with `noopener noreferrer`. Network evidence describes read access or a network selector, never successful transactions.

| Project | Canonical destination | Evidence and limits |
|---|---|---|
| Adena | https://www.adena.app/ | [Official Gno documentation](https://docs.gno.land/users/third-party-wallets/) identifies the browser wallet. adena.app redirects here. External tool; no installed-release network matrix was verified. |
| GnoSwap | https://gnoswap.io/ | beta.gnoswap.io now redirects here. Live application links [core realm source](https://github.com/gnoswap-labs/gnoswap). Network remains unverified; the old Beta label is removed. |
| Boards | https://gno.land/r/gnoland/boards2/v0 | Realm and [$source](https://gno.land/r/gnoland/boards2/v0$source) return 200 with `gnoconnect:chainid=gnoland-1`. v1 returns 404 on this chain. Fixed mainnet links do not inherit Memba's selected network. |
| Akkadia | https://abp.akkadia.land/ | Project identifies a builder preview. Network not verified; no general mainnet availability claim. |
| GnoScan | https://gnoscan.io/ | The project UI offers Mainnet, Staging and custom network choices. Link opens the explorer root; visitor selects its network. No guessed realm deep-link format. |
| Gno Playground | https://play.gno.land/ | Reachable browser workspace. Sandbox/tool, no chain-deployment claim. |
| mygnoscan | https://mygnoscan.moul.p2p.team/storage?network=mainnet | Browser shows mainnet selected and live block 236,314 at inspection. Footer links [source](https://github.com/gnoverse/mygnoscan) and attributes indexed data. External link only; no data ingestion or authoritative deployment-pricing claim. |

All seven destinations returned HTTPS 200 after redirects with certificate verification enabled. Public source repositories for GnoSwap and mygnoscan were also verified through GitHub. Reachability is distinct from network availability and endorsement. Recheck destinations and evidence before editing availability claims.

`lib/ecosystemDirectory.ts` records project identity, category, maturity, explicit network evidence, check date and optional verified realm/source links. The availability filter keeps tools and unknown app networks distinct; All remains the default. Search and facets use bounded URL parameters. No remote lookup is needed to browse the editorial catalog.

The public index remains available when the registry flag is off **or** the exact configured registry path is ineligible on the selected network. Nested detail, publishing, submission and curation routes retain that same boundary. This consumes existing `isRealmValidOn` policy; it does not change flags, allowlists or publication records. On an eligible network the existing registry remains available when enabled.
