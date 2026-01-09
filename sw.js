const CACHE_NAME = 'pep-log-v2'; // J'ai incrémenté la version pour forcer la mise à jour
const ASSETS = [
  './index.html',
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
      // On utilise addAll pour les fichiers locaux, et on gère les erreurs pour les CDNs externes
      // (parfois les CDNs bloquent les requêtes opaques en cache strict)
      return cache.addAll(ASSETS).catch(err => console.warn("Erreur cache assets:", err));
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
