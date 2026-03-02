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

## Acknowledgment

We appreciate responsible disclosure and will credit security researchers in our changelog (unless anonymity is requested).

---

*This policy is maintained by [Samouraï Coop](https://www.samourai.world).*
