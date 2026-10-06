// Kill switch for the service worker of the retired classic host (memba.samourai.app).
// When that host serves this file in place of /sw.js, a returning visitor's old worker
// updates to it: it clears the precache, unregisters itself and reloads open tabs, which
// then reach the host's redirect to memba.club. Local storage is left alone.
// Serve it only where every page redirects away: a page that loads registers /sw.js again,
// gets this file and reloads, without end.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil((async () => {
    await self.clients.claim()
    for (const key of await caches.keys()) await caches.delete(key)
    await self.registration.unregister()
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url)
})()))
