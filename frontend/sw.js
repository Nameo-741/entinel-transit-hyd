// ═══════════════════════════════════════════════════════════
//  SENTINEL TRANSIT HYD — Service Worker
//  Strategy: Network-First, fallback to Cache
//  Ensures the app works offline after the first load.
// ═══════════════════════════════════════════════════════════

const CACHE_NAME = 'sentinel-transit-v2';

// Core shell files to pre-cache on install
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  // Leaflet (map library)
  'https://unpkg.com/leaflet/dist/leaflet.css',
  'https://unpkg.com/leaflet/dist/leaflet.js',
  // Sora font
  'https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&display=swap'
];

// ── INSTALL: Pre-cache the app shell ──
self.addEventListener('install', (event) => {
  console.log('[SW] Installing — caching app shell');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()) // Activate immediately
  );
});

// ── ACTIVATE: Clean up old caches from previous versions ──
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating — cleaning old caches');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim()) // Take control of all pages immediately
  );
});

// ── FETCH: Network-First, fallback to Cache ──
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET requests (POST to /api/chat, etc.)
  if (request.method !== 'GET') return;

  // Skip Chrome extension and dev-tools requests
  if (request.url.startsWith('chrome-extension://')) return;

  // For API calls — always try network, never serve stale cache
  if (request.url.includes('/api/')) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(
          JSON.stringify({ error: 'You are offline. Please reconnect.' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // For everything else: Network-First with cache fallback
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        // Clone the response before caching (responses are single-use streams)
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseClone);
        });
        return networkResponse;
      })
      .catch(() => {
        // Network failed — try the cache
        return caches.match(request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;

          // Last resort: if navigating, serve the cached index.html (SPA fallback)
          if (request.mode === 'navigate') {
            return caches.match('/index.html');
          }

          // Nothing in cache either
          return new Response('Offline — resource not cached.', {
            status: 503,
            statusText: 'Service Unavailable'
          });
        });
      })
  );
});
