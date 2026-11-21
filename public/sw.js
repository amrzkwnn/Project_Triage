const SHELL_VERSION = 'daily-helper-shell-v1';
const SHELL_URLS = [
  '/',
  '/my-data',
  '/scam-shield',
  '/photo-helper',
  '/inbox',
  '/media-check',
  '/calendar',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_VERSION)
      .then((store) => store.addAll(SHELL_URLS).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_VERSION)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  // Never cache server endpoints carrying private items or settings
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches
              .open(SHELL_VERSION)
              .then((store) => store.put(request, copy))
              .catch(() => undefined);
          }
          return response;
        })
        .catch(() =>
          caches
            .match(request)
            .then((matched) => matched || caches.match('/'))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((matched) => {
      if (matched) {
        return matched;
      }
      return fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches
              .open(SHELL_VERSION)
              .then((store) => store.put(request, copy))
              .catch(() => undefined);
          }
          return response;
        })
        .catch(() => matched);
    })
  );
});
