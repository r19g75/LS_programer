// Cache-first offline (sekcja 5.1 spec) — BLE i Modbus działają lokalnie,
// strona nie potrzebuje sieci do komunikacji z ESP32, tylko do pierwszego
// pobrania/aktualizacji.

const CACHE_NAME = 'g100-programator-v10';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/catalog.js',
  './js/scaling.js',
  './js/config-store.js',
  './js/ble-client.js',
  './js/modbus-client.js',
  './js/ui.js',
  './js/debug-panel.js',
  './js/app.js',
  './data/g100_catalog_full.json',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response.ok && event.request.method === 'GET') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
