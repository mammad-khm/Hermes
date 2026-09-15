// Minimal offline shell for the installed app. API calls are never cached.
const CACHE = 'hermes-console-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return
  event.respondWith(
    (async () => {
      try {
        const response = await fetch(event.request)
        if (response.ok) (await caches.open(CACHE)).put(event.request, response.clone())
        return response
      } catch {
        const cached = (await caches.match(event.request)) || (event.request.mode === 'navigate' ? await caches.match('./') : undefined)
        return cached || Response.error()
      }
    })(),
  )
})
