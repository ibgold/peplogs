const CACHE_NAME = 'pep-log-v4'; // J'ai incrémenté la version pour forcer la mise à jour
const ASSETS = [
  './index.html',
  './planning.js',
  './manifest.json',
  './logo.png', // Ajout du logo au cache pour le mode hors-ligne
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/hammer.js/2.0.8/hammer.min.js',
  'https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@1.2.1/dist/chartjs-plugin-zoom.min.js',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap'
];

// 1. Installation : On met en cache les fichiers statiques (App Shell)
self.addEventListener('install', (event) => {
  self.skipWaiting(); // Force le nouveau SW à s'activer immédiatement
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache the complete local app before activation; a CDN failure must not discard it.
      const local = ASSETS.filter(url => url.startsWith('./'));
      const external = ASSETS.filter(url => !url.startsWith('./'));
      return cache.addAll(local).then(() => Promise.all(
        external.map(url => cache.add(url).catch(err => console.warn('Optional asset unavailable:', url, err)))
      ));
    })
  );
});

// 2. Activation : On nettoie les anciens caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim()) // Prend le contrôle des clients immédiatement
  );
});

// 3. Interception des requêtes (Stratégie: Network First, falling back to Cache)
self.addEventListener('fetch', (event) => {
  // On ignore les appels API vers Google Script (toujours en ligne)
  if (event.request.url.includes('script.google.com')) {
    return;
  }

  // Pour les autres requêtes (HTML, JS, CSS)
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Si la réponse est valide, on la clone dans le cache pour la prochaine fois
        if (!response || response.status !== 200 || response.type !== 'basic' && response.type !== 'cors' && response.type !== 'opaque') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          try {
             // On ne met en cache que les GET
             if(event.request.method === 'GET') {
                 cache.put(event.request, responseToCache);
             }
          } catch(e) {}
        });
        return response;
      })
      .catch(() => {
        // Si le réseau échoue, on regarde dans le cache
        return caches.match(event.request);
      })
  );
});

// 4. Clic sur une notification de rappel → ouvre / met au premier plan l'app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
