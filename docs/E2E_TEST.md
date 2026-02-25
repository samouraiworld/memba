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

## Post-Test

- [ ] Screenshot key states for documentation
- [ ] Report any issues as GitHub Issues on `samouraiworld/memba`
- [ ] If all pass → tag v2.0.1 and deploy
