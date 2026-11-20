// Gestori delle notifiche push, caricati dal service worker generato da Workbox (vite.config.ts → workbox.importScripts).
// Il caching resta a Workbox; qui c'è solo il push. Le chiamate cross-origin (Google) non vengono mai intercettate.

// Tocco su una notifica: riporta in primo piano l'app (o la apre)
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => (cs.length ? cs[0].focus() : self.clients.openWindow('./'))),
  )
})

// Notifica push dal server (anche ad app chiusa). Se l'app è in primo piano non si mostra nulla: la sincronizza subito e
// mostra la propria campanella. Lo stesso `tag` della notifica locale evita doppioni.
self.addEventListener('push', (e) => {
  let data = {}
  try { data = e.data ? e.data.json() : {} } catch { data = { body: e.data ? e.data.text() : '' } }
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      if (wins.some((c) => c.visibilityState === 'visible')) {
        wins.forEach((c) => c.postMessage({ type: 'mealduo-push' }))
        return undefined
      }
      return self.registration.showNotification(data.title || 'Meal Duo', {
        body: data.body || '', tag: data.tag || undefined, icon: './icons/pwa-192.png', badge: './icons/pwa-192.png',
      })
    }),
  )
})
