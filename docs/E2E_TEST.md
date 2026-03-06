# E2E Test — Samourai Crew Multisig Flow

> Manual end-to-end test checklist for verifying Memba on the live deployment.
> Target: samourai-crew 3-of-7 multisig on `test11`.

## Prerequisites

- [ ] Adena browser extension installed
- [ ] At least 2 test accounts funded with GNOT on test11
- [ ] Backend deployed and healthy (`/health` returns 200)
- [ ] Frontend deployed and reachable

## 1. Authentication

| # | Step | Expected |
|---|------|----------|
| 1.1 | Open Memba → click "Connect Wallet" | Adena popup appears |
| 1.2 | Approve connection in Adena | Address + balance shown in header |
| 1.3 | Refresh page | Session persists (no reconnect needed) |
| 1.4 | Click "Disconnect" | Returns to "Connect Wallet" state |

## 2. Multisig Import

| # | Step | Expected |
|---|------|----------|
| 2.1 | Connect wallet → click "Import Existing" | Import form shown |
| 2.2 | Paste samourai-crew pubkey JSON | Address derived, member count shown |
| 2.3 | Submit import | Success, redirected to multisig view |
| 2.4 | Return to Dashboard | Multisig count = 1, multisig listed |

## 3. Propose Transaction

| # | Step | Expected |
|---|------|----------|
| 3.1 | Open multisig → "Propose Transaction" | Form shown with recipient, amount, memo |
| 3.2 | Enter valid recipient + 0.1 GNOT | Form validates |
| 3.3 | Submit proposal | TX created, redirected to TX view |
| 3.4 | Dashboard → "Pending Transactions" | New TX listed with "Pending" badge |

## 4. Sign Transaction

| # | Step | Expected |
|---|------|----------|
| 4.1 | Open pending TX → "Sign Transaction" | Adena sign popup appears |
| 4.2 | Approve in Adena | Signature counted, badge updates to "1/3 Signed" |
| 4.3 | Second member connects + signs | Badge updates to "2/3 Signed" |
| 4.4 | Third member connects + signs | Badge transitions to "Ready" (3/3) |

## 5. Broadcast

| # | Step | Expected |
|---|------|----------|
| 5.1 | When threshold met → "Broadcast to Chain" | Adena broadcast popup |
| 5.2 | Approve broadcast | Final hash stored, badge → "Complete" |
| 5.3 | TX view shows hash | Full tx hash displayed, clickable |

## 6. TX Detail Page

| # | Step | Expected |
|---|------|----------|
| 6.1 | Click any TX from Dashboard | TX detail page loads |
| 6.2 | Verify parsed amount | Shows "0.1 GNOT" (not raw ugnot) |
| 6.3 | Verify signer list | All signers shown with Signed/Pending status |
| 6.4 | Verify fee | Gas amount displayed |
| 6.5 | Verify metadata | Chain ID, memo, account #, sequence shown |

## 7. Edge Cases

| # | Step | Expected |
|---|------|----------|
| 7.1 | Non-member tries to view TX | "Not found" or "not a member" error |
| 7.2 | Navigate to `/tx/99999` | "Transaction not found" message |
| 7.3 | Disconnect mid-session → refresh | Graceful redirect to connect state |
| 7.4 | Resize to 375px width | All content readable, no overflow |

## 8. DAO Archive (v5.3.0)

| # | Step | Expected |
|---|------|----------|
| 8.1 | Navigate to an archived DAO → DAOHome | `📦 ARCHIVED` badge next to name + amber warning banner |
| 8.2 | Check "New Proposal" button | Hidden (not shown for archived DAOs) |
| 8.3 | Navigate to DAOList with mix of active + archived | Archived card dimmed (opacity) + `📦 Archived` badge |
| 8.4 | Open an active proposal on archived DAO | Vote/Execute buttons hidden + amber info banner |
| 8.5 | Navigate to `/dao/:slug/propose` on archived DAO | Amber warning + submit button disabled |

## 9. User Profile (v5.3.0)

| # | Step | Expected |
|---|------|----------|
| 9.1 | Connect wallet → click "👤 Profile" in header | ProfilePage loads for connected address |
| 9.2 | Verify header card | Avatar, address (CopyableAddress), badges |
| 9.3 | Profile with registered username | Shows `@username` + gno.land link |
| 9.4 | Profile without username (own) | Shows "Register your @username →" CTA |
| 9.5 | Profile with gnolove data | GitHub stats, contribution score, deployed packages |
| 9.6 | Profile with no data at all | Empty state: "No profile data yet" |
| 9.7 | Click 👤 icon next to member in DAOHome | Navigates to `/profile/{address}` |
| 9.8 | Click 👤 icon next to member in DAOMembers | Navigates to `/profile/{address}` |

## 10. Username & Encoding (v5.3.0)

| # | Step | Expected |
|---|------|----------|
| 10.1 | Open a DAO with registered members | `@usernames` shown on DAOHome + DAOMembers |
| 10.2 | Open a DAO with threshold/quorum display | No mojibake (no `â€"`) — clean `|` or em dash |
| 10.3 | Unregistered member → DAOHome (authenticated) | "Create your username" CTA card shown |

## 11. Profile Edit (v5.4.0)

| # | Step | Expected |
|---|------|----------|
| 11.1 | Connect wallet → open own profile | "✏️ Edit" button visible next to "YOU" badge |
| 11.2 | Click "✏️ Edit" | Edit form appears with 7 fields (bio, company, title, avatar URL, twitter, github, website) |
| 11.3 | Fill bio + company + title → Save | ✓ Saved feedback, form closes, fields shown on profile |
| 11.4 | Refresh page | Edited fields persist (loaded from backend) |
| 11.5 | Visit another user's profile | No "✏️ Edit" button visible |
| 11.6 | Enter bio > 512 chars | Character count shows limit, input truncated at 512 |
| 11.7 | Enter invalid avatar URL | Rejected server-side (empty on reload) |
| 11.8 | Own profile, no GitHub linked | "🐙 Link your GitHub account" CTA card shown with link to gnolove.world |
| 11.9 | Own profile, GitHub already linked | No CTA card shown, GitHub data displayed normally |
| 11.10 | Set avatar via external URL | Avatar displayed via `<img>` tag, fallback 👤 on CORS error |
| 11.11 | GovDAO proposal page (as member) | "You are a DAO member" — voting buttons enabled |
| 11.12 | GitHub social link icon | Proper Invertocat SVG (not 🐙 emoji) |
| 11.13 | Click "Link GitHub" CTA | Redirects to GitHub OAuth (not gnolove.world) |
| 11.14 | Complete GitHub OAuth flow | GithubCallback page shows verify step, MsgCall signs |
| 11.15 | Register username (@foo) | Inline form → Adena popup → success → profile refreshes |
| 11.16 | Register invalid username | Validation shows "≥3 letters + ≥3 digits (e.g. zooma1337)" |
| 11.17 | Register username `zooma1337` | MsgCall with `args: ["zooma1337"]` succeeds |
| 11.18 | Link GitHub (OAuth flow) | Saves login to backend profile, redirects to profile |
| 11.19 | Navigate to `/u/the_sw360cab_250` | Resolves username → address, redirects to profile |
| 11.20 | Navigate to `/u/nonexistent` | Shows "User not found" with Go Home button |
| 11.21 | GovDAO member list | Username shown first, address truncated `g1abc...xyz` |
| 11.22 | GovDAO proposal (already voted) | Shows "✓ You voted YES" badge, buttons disabled |

## 12. SingleVoteBar & Participation (v2.0)

| # | Step | Expected |
|---|------|----------|
| 12.1 | Navigate to GovDAO → open a proposal with votes | Single-line vote bar: filled width = participation %, green YES / red NO split |
| 12.2 | Check participation percentage | Shows "XX% participated" with 50% threshold marker |
| 12.3 | Participation < 50% | Bar partially filled, below threshold marker |
| 12.4 | Participation ≥ 50% | Bar crosses threshold marker |
| 12.5 | Open ProposalView (detail page) for same proposal | Same SingleVoteBar visible + TierPieChart SVG donut |
| 12.6 | TierPieChart visible | Shows vote distribution by tier (T1/T2/T3 segments) |

## 13. Dashboard Guard (v1.7.1)

| # | Step | Expected |
|---|------|----------|
| 13.1 | Load Memba without Adena connected | Dashboard nav link NOT visible in header |
| 13.2 | Navigate directly to `/dashboard` URL | Auto-redirect to `/` (landing page) |
| 13.3 | Connect Adena wallet | Dashboard nav link appears in header |
| 13.4 | Click Dashboard link | Dashboard page loads with identity card + feature cards |
| 13.5 | Disconnect wallet while on Dashboard | Redirected to landing page |

## Post-Test

- [ ] Screenshot key states for documentation
- [ ] Report any issues as GitHub Issues on `samouraiworld/memba`
- [ ] If all pass → tag release and deploy
