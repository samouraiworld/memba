# EVM Deploy Ceremony — required post-deploy Safe transactions

> **Why this file exists.** `Deploy.s.sol` runs from a deployer EOA, but every contract is
> owned by the Samouraï Coop **Safe**. Some wiring can therefore only be done *after* deploy,
> by the Safe — the deployer has no authority to do it. These steps are **not optional**: skip
> one and a whole feature is dead on arrival, with no error at deploy time. Each step below is
> also printed by the deploy script as an `ACTION REQUIRED (Safe tx)` line.
>
> Run these in order, from the Safe, before announcing the deployment. After each, run the
> verification call and confirm the expected result.

The deploy script prints every address you need (`[Core] …`, `[Commerce] …`, and the
`ACTION REQUIRED` lines). Capture that output — the ceremony references it.

---

## Step 1 — Grant the Candidature proxy `ADMIN_ROLE` on the DAO  (closes A-2 / ISSUE-007)

`MembaCandidature.markApproved` calls `MembaDAO.addMember`, which is `onlyRole(ADMIN_ROLE)`.
The DAO is created with `admin = safe`, so **only the Safe** can grant the role — the deployer
cannot. Without it, `markApproved` reverts `AccessControlUnauthorizedAccount` **100% of the
time** and no applicant can ever be admitted.

**Safe transaction**

```
target: <First DAO address>          // [Core] First DAO
function: grantRole(bytes32,address)
  role:    ADMIN_ROLE = keccak256("ADMIN_ROLE")
           = 0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775
  account: <Candidature address>      // [Core] Candidature
```

**Verify**

```
MembaDAO(dao).hasRole(ADMIN_ROLE, candidature) == true
```

Regression guard: `test/MembaCandidature.t.sol::test_A2_MarkApprovedRevertsWithoutDAOAdminGrant`
pins the un-granted deployment failing loudly; `…SucceedsAfterSafeGrant` pins this remedy.

---

## Step 2 — Authorise Collections as the NFT launchpad  (completes A-1)

`MembaCollections.mintNFT` mints into `MembaNFT` through the launchpad hook, gated on
`msg.sender == $.launchpad`. `MembaNFT` is initialized with `admin = safe` and an unset
launchpad, and `setLaunchpad` is `onlyAdmin`. Until the Safe wires it, the launchpad's only
revenue function reverts. (The A-1 code fix made the mint *reachable*; this step makes it
*live*.)

**Safe transaction**

```
target: <NFT address>                // [Commerce] NFT
function: setLaunchpad(address)
  newLaunchpad: <Collections address> // [Commerce] Collections
```

**Verify**

```
MembaNFT(nft).launchpad() == collections
```

Regression guard: `test/MembaCollections.t.sol` sets the launchpad in its fixture; the
integration wiring is exercised there.

---

## Step 3 — Accept ownership of the DAO factory  (closes C-4)

`MembaDAOFactory` is non-upgradeable and `setImplementation` — which repoints the DAO
template used by every **future** `createDAO` — is `onlyOwner`. The factory is created owned
by the deployer EOA, so `Deploy.s.sol` calls `factory.transferOwnership(safe)`. Because the
factory uses **`Ownable2Step`**, that only *nominates* the Safe; the deployer stays owner
until the Safe accepts. Two-step is deliberate: a one-step transfer to a typo'd
`SAFE_MULTISIG_ADDRESS` would strand the factory and freeze `setImplementation` forever.
**Until this step completes, a compromised deployer key can still swap the DAO template.**

**Safe transaction**

```
target: <DAOFactory address>         // [Core] DAOFactory
function: acceptOwnership()
```

**Verify**

```
MembaDAOFactory(factory).owner() == safe
MembaDAOFactory(factory).pendingOwner() == address(0)
```

Regression guard: `test/MembaDAO.t.sol::test_C4_*` (handover, deployer-locked-out after accept,
existing DAOs unaffected).

---

## Before you finish

- Re-read the deploy log and confirm **every** `ACTION REQUIRED` line has a matching executed
  Safe transaction. If a future contract change adds a new one, add a step here in the same PR.
- If `TIMELOCK_DELAY` was set, upgrades now route through the `TimelockController` — the
  ceremony above uses `grantRole`/`setLaunchpad`/`acceptOwnership`, which are **not** upgrades
  and are not time-locked, so they take effect immediately.
