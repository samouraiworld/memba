---
title: What you sign is what you saw
date: 2026-10-05
description: Memba asks the wallet once per action, checks a cancellation on chain, activates new addresses by a self-send, and states fees and deposits first.
tags: memba, security, signing, engineering
---

A signing flow is honest when the screen, the wallet and the chain agree, and
when it says so plainly if they do not. These changes make Memba ask the wallet
less, check the chain more, and report only what it observed.

## What you get (product)

Memba asks the wallet once per action and no longer reopens Adena by itself
after a failure. If you cancel in Adena after its window opened, Memba waits
three blocks and compares your account: it says nothing changed when nothing
did, or that the outcome is unknown when it cannot check, and keeps the action
locked until it is checked. A locked Adena is asked to unlock in its own window,
and signing continues. Signing in with Adena on another network offers to
switch, and a failed sign-in says why: Adena declined, a session account cannot
sign, Adena needs an update, or the account must be activated.

Activation itself is a transfer of 1 ugnot from a new address to itself,
reviewed in its own step, in Memba OS and on the classic page alike. It costs
only the network fee, about 0.0024 GNOT, and locks no storage deposit; a cancel
says nothing was sent.

## Under the hood (engineering scope)

Memba OS's DAO vote and proposal sheets show the network fee Memba requests,
check it again just before the wallet opens, and send that figure; a fee set in
Settings is checked against what the network charges. The review sheet also
says plainly that Adena sets the fee it finally signs from its own gas
estimate, usually lower, so check it in Adena before approving.

The review sheet is wider on desktop and lets long values wrap, so every row of
what Adena should show is visible without scrolling sideways. A transaction the
network ran and refused is reported as refused (it took no effect, and its fee
was still charged) and that outcome is read only from a node of the current
network. Profile publishing, username registration and App Store submissions,
edits and delists now send gas limits sized from measurements, cap their
storage deposit, state the deposit and the fee before the wallet opens, and are
checked on chain first.

---

Built by [Samourai Coop](https://samourai.world), in the open at
[github.com/samouraiworld/memba](https://github.com/samouraiworld/memba). Try a
signature at [memba.club](https://memba.club).
