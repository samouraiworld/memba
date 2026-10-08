---
title: Native Gno multisig on memba.club
date: 2026-10-02
updated: 2026-10-07
description: Create a native gno.land multisig on memba.club, collect signatures to its threshold and broadcast, with fixed bytes and a chain check before any re-send.
tags: memba, multisig, security, engineering
---

gno.land has multisig accounts built into the chain: one address derived from
several members' public keys and a threshold. memba.club now creates and runs
them natively, from the first proposal to the broadcast.

## What you get (product)

Create a multisig from its members' public keys and the threshold; the new
account opens as soon as it exists. With none yet, the Multisig app explains
what a multisig is and how a member's key reaches the chain. Propose a
transaction, collect signatures up to the threshold and broadcast. The
account's window lists what it received and sent on chain, names the proposal a
send executed, and links each transaction on gnoscan. Guests can open any
account's address, balance and history; a connect prompt appears only where
your own multisigs would show.

**Updated 7 October.** Membership is the key: when another member registers an
account you belong to, you see its proposals and can sign them at once, and
joining only keeps it in your list. The Multisig app, the bell and Home count
the proposals waiting for your signature. If you have not named an account,
you see the name its first namer gave, marked with who that is; your own name
always wins. One limit remains: anyone holding a member's public key can
register a multisig with it, so an account you have not joined shows only as a
count, with a neutral label, outside its own page.

## Under the hood (engineering scope)

Once a transaction reaches its quorum, its bytes and hash are fixed. A refusal
by the chain while running closes the proposal with the chain's reason; a
refusal before execution keeps the signed transaction valid to broadcast again.
If a broadcast reply is lost, Memba keeps the hash on the page, and the next
press asks the chain first: it sends again only when Memba's own single node
says the transaction is absent. A silent node is never read as absence, and
when the server cannot check receipts, nothing is sent.

The fee defaults to twice a fresh network gas price for the gas limit, because
signatures can take days to gather, and Memba refuses to broadcast when a fresh
price has outgrown the fee everyone signed. Native multisig supports bank sends
and VM calls only.

---

Built by [Samourai Coop](https://samourai.world), in the open at
[github.com/samouraiworld/memba](https://github.com/samouraiworld/memba). Open
the [Multisig app on memba.club](https://memba.club/os/multisig).
