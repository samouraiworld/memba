---
title: Memba OS: a desktop for gno.land
date: 2026-09-26
updated: 2026-09-28
description: Memba OS opens DAOs, the wallet, multisigs and every app as windows on a desktop at memba.club, with a review sheet before each signature in its native windows.
tags: memba, os, design, engineering
---

Memba OS is a second way to use Memba: a desktop in the browser, where DAOs,
the wallet, multisigs and every other app open as windows. It is the
interface at [memba.club](https://memba.club), starts at `/os`, and is a beta.

## What you get (product)

Each plain visit plays a two-second boot, which any key skips and reduced motion
turns off, then a lock screen with a Connect or Guest choice. A shared link goes
straight in, and Settings can skip the introduction. The menu bar holds the start menu, the network (with a TESTNET
warning off mainnet), notifications and your account. Windows drag, resize,
minimize to the dock and tile. The address bar follows the front window, so a
link reopens the same windows, and ⌘K searches apps, DAOs, pages and commands;
a pasted `g1` address opens its profile.

Every signature from a native window starts in a review sheet: what happens, where, the deposit cap,
and what Adena should show, decoded from the exact messages it will sign. Adena
opens only if those messages match. Proposals and DAOs are created in wizard windows with a live preview and a
saved draft. The Wallet sends GNOT to a `g1` address or an @name, showing the
address the name resolves to and checking it again before the wallet opens.
Multisigs have windows of their own; since 28 September, so do the Feed, Live
activity, a read-only Terminal with Learn lessons, and Meet calls.

On a phone the desktop becomes a home screen with a dock, and each window opens
as a full-screen sheet. Guests can browse; a connect prompt appears only where
your own data or a signature is needed.

## Under the hood (engineering scope)

A build gate fails any Memba OS build meant for another site, and checks that
a build without it ships none of its code. Each app's windows load the first
time they open, so the shell loads about 40% less code, and both themes meet
WCAG 2.1 AA contrast. An app goes native by adding one folder that uses a
shared kit, while a
design-token bridge renders Memba's existing pages in the Aqua theme inside their
windows. Production QA then hardened the Terminal (each
RPC's chain identity checked before a read), Settings, and the shell, whose
saved windows and signing state are partitioned by member and network.

---

Built by [Samourai Coop](https://samourai.world), in the open at
[github.com/samouraiworld/memba](https://github.com/samouraiworld/memba). Try it
at [memba.club](https://memba.club).
