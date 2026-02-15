const CACHE_NAME = 'pa-offline-v3';
const DOCS_CACHE = 'pa-docs-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll([OFFLINE_URL]);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => ![CACHE_NAME, DOCS_CACHE].includes(key))
          .map((key) => caches.delete(key))
      );

      // Purge any stale Next.js runtime chunks that may have been cached by older SW logic.
      for (const cacheName of [CACHE_NAME, DOCS_CACHE]) {
        const cache = await caches.open(cacheName);
        const requests = await cache.keys();
        await Promise.all(
          requests.map((req) => {
            try {
              const u = new URL(req.url);
              if (u.origin === self.location.origin && u.pathname.startsWith('/_next/')) {
                return cache.delete(req);
              }
            } catch {
              // ignore malformed URLs
            }
            return Promise.resolve(false);
          })
        );
      }

      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.headers && request.headers.has('range')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          const cached = await cache.match(request);
          return cached || cache.match(OFFLINE_URL);
        })
    );
    return;
  }

  if (request.method === 'GET') {
    const reqUrl = new URL(request.url);
    if (reqUrl.origin !== self.location.origin) {
      return;
    }
    if (reqUrl.pathname.startsWith('/_next/')) {
      // Never cache Next.js runtime/chunk assets in SW. Stale chunks cause client-side crashes.
      return;
    }
    if (reqUrl.pathname.startsWith('/api/')) {
      return;
    }
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((response) => {
            const cacheable = response && (response.ok || response.type === 'opaque');
            if (cacheable) {
              const copy = response.clone();
              caches.open(DOCS_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
            }
            return response;
          })
          .catch(() => cached);
      })
    );
  }
});
