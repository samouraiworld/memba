# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Memba, **please do not open a public issue**.

Instead, report it responsibly via email:

📧 **security@samourai.coop**

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Suggested fix (if any)

### Response Timeline

| Action | Timeline |
|--------|----------|
| Acknowledgment | Within 48 hours |
| Initial assessment | Within 5 business days |
| Fix & disclosure | Coordinated with reporter |

## Scope

The following are in scope for security reports:

- **Backend API** (Go / ConnectRPC)
- **Frontend application** (React / Vite)
- **Authentication flow** (ed25519 challenge-response)
- **GitHub OAuth integration**
- **Gno smart contract interactions**
- **Infrastructure** (Fly.io, Netlify deployment)

## Out of Scope

- Third-party services (Adena wallet, GitHub API, Gno.land RPC)
- Denial of service attacks
- Social engineering
- Issues that require physical access to a user's device

## Published Advisories

Resolved issues are written up in full under [`docs/advisories/`](docs/advisories/) — one
file per advisory, named for its ID. Each carries the affected range, the fix version, a
CVSS vector, the remediation, and the regression tests that keep it fixed.

IDs follow `MEMBA-<year>-<NNN>`, assigned in order of disclosure rather than discovery.

| ID | Summary | Severity | Affected | Fixed in |
|----|---------|----------|----------|----------|
| [MEMBA-2026-001](docs/advisories/MEMBA-2026-001.md) | Cross-chain signature replay in the login proof (AUTH-CHAINID-01) — a signature obtained in a hostile chain context could be replayed against another chain, because the signed document did not bind the chain id. | High — CVSS 7.4 (`AV:N/AC:H/PR:N/UI:R/S:C/C:H/I:H/A:N`) | ≤ v6.0.0 | **v6.0.2** |

An advisory is published here once the fix has shipped. Until then the report stays
private and the fixing PR describes the change factually, without an exploit walkthrough.

## Acknowledgment

We appreciate responsible disclosure and will credit security researchers in our changelog (unless anonymity is requested).

---

*This policy is maintained by [Samouraï Coop](https://www.samourai.world).*
