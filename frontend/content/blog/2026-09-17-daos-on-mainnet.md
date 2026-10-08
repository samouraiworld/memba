---
title: Create a DAO on gno.land mainnet
date: 2026-09-17
description: Memba deploys version-2 DAOs on gno.land mainnet, with vote-only membership, bounded voting power, timed windows and a full review before you sign.
tags: memba, dao, governance, engineering
---

Since 17 September, gno.land mainnet is the network Memba opens on, and you can
create a DAO there. A DAO is a permanent realm, so the work went into what it
can do once deployed, and into showing you all of it before you sign.

## What you get (product)

Create DAO deploys under your own address or registered name. gno.land enables
new packages through its own approval step, so Memba never reports a DAO as
created before the network has enabled it: until then the page shows the realm
path and transaction hash, and My DAOs lists the DAO as waiting and re-checks
it when you open it. The review shows the network, the permanent realm path,
the storage deposit estimate and cap, the network fee and the voting windows.

Every DAO has Overview, Proposals, Members and Settings pages. One proposal
form covers text, add member, remove member, change roles and archive, using
the DAO's own categories and roles, and its preview is the transaction the
wallet signs. Proposal pages say when voting ends, and when an accepted
proposal can be executed and until when. Buttons appear only for actions Memba
can build for that contract: GovDAO is vote and execute only,
and unrecognized contracts are read-only. GovDAO status comes from the realm's
generated fields, not from the first status-like word in a description.

## Under the hood (engineering scope)

New DAOs use template `memba-dao/2`. Roles are labels with no powers: every
membership, role or archive change is a proposal, executed at least an hour
after it passes. Voting power per member is bounded so tallies cannot
overflow, thresholds must be above 50%, and the voting period, execution delay
and execution window are measured in seconds. Reads use paginated JSON parsed
against strict schemas, and deploys send `max_deposit` sized from storage
measured on the gnoland-1 runtime.

Votes stay bound to the electorate that opened them: adding or removing a
member closes older open proposals. Text a proposer writes can no longer stand
in for the author, status or tallies the realm generates. Member data comes
only from a memberstore the DAO links from its own Members section under its
own path; "You voted" matches only your exact address or username; and the
backend reads usernames from the registry's address lookup and serves the home
snapshot only for the chain its node reports.

---

Built by [Samourai Coop](https://samourai.world), in the open at
[github.com/samouraiworld/memba](https://github.com/samouraiworld/memba). Start
one from the [DAOs app on memba.club](https://memba.club/os/daos).
