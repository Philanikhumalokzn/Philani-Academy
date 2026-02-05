const CACHE_NAME = 'pa-offline-v2';
const DOCS_CACHE = 'pa-docs-v1';
const OFFLINE_URL = '/offline.html';

const collectNextStaticUrls = (htmlText) => {
  if (!htmlText) return [];
  const matches = htmlText.match(/\/_next\/static\/[^"'\s)]+/g) || [];
  return Array.from(new Set(matches));
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll([OFFLINE_URL]);
      try {
        const res = await fetch('/dashboard');
        const html = await res.text();
        const urls = collectNextStaticUrls(html);
        await Promise.all(urls.map((url) => cache.add(url).catch(() => {})));
      } catch {
        // ignore
      }
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
