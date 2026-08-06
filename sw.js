// sw.js — light offline cache. Not required (app is now online-first), but
// harmless resilience if the connection briefly drops.
const CACHE_NAME = 'quotation-generator-v2';
const APP_SHELL = [
  './', './index.html', './style.css', './app.js', './utils.js', './storage.js',
  './file-saver.js', './logo-data.js', './pdf-export.js', './docx-export.js',
  './manifest.json', './icon-192.png', './icon-512.png',
  './jspdf.umd.min.js', './docx.umd.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
