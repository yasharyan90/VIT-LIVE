/* VIT Live service worker: offline app shell + web push display.
   Cache strategy:
   - navigations: network-first, fall back to cached shell when offline
   - build assets (/assets/*): cache-first (they're content-hashed)
   - API/WS/uploads: never cached — the app reconciles over REST itself. */

const SHELL_CACHE = 'vitlive-shell-v1'
const ASSET_CACHE = 'vitlive-assets-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(['/', '/manifest.webmanifest', '/icon.svg'])),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k)),
      ),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws') || url.pathname.startsWith('/uploads/')) return

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((resp) => {
          const copy = resp.clone()
          caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy))
          return resp
        })
        .catch(() => caches.match('/')),
    )
    return
  }

  if (url.pathname.startsWith('/assets/') || url.pathname === '/icon.svg' || url.pathname === '/manifest.webmanifest') {
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ||
          fetch(event.request).then((resp) => {
            const copy = resp.clone()
            caches.open(ASSET_CACHE).then((cache) => cache.put(event.request, copy))
            return resp
          }),
      ),
    )
  }
})

/* ---- Web push (FCM data arrives as a push event with JSON payload) ---- */

self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload = {}
  try {
    payload = event.data.json()
  } catch {
    payload = { notification: { title: 'VIT Live', body: event.data.text() } }
  }
  const n = payload.notification || {}
  const data = payload.data || {}
  event.waitUntil(
    self.registration.showNotification(n.title || 'VIT Live', {
      body: n.body || '',
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag: data.id || undefined,
      data,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  let path = '/'
  if (data.type === 'announcement') path = '/'
  else if (data.type === 'event' || data.type === 'event_reminder') path = '/events/' + (data.id || '')
  else if (data.type === 'poll') path = '/polls/' + (data.id || '')
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const win of wins) {
        if (win.url.startsWith(self.location.origin)) {
          win.focus()
          win.navigate(path)
          return
        }
      }
      return clients.openWindow(path)
    }),
  )
})
