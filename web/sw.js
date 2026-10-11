/* Service worker minimal : garde l'interface (pas les données) pour un démarrage rapide.
   Il ne touche jamais à /api, /auth, /mcp ni /.well-known. */
var VERSION = 'revision-ui-v1';
var INTERFACE = ['/', '/index.html', '/style.css', '/app.js', '/config.js', '/legal.js', '/manifest.webmanifest',
  '/vendor/marked.umd.js', '/vendor/purify.min.js', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png',
  '/confidentialite.html', '/conditions.html'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(INTERFACE); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (noms) {
    return Promise.all(noms.filter(function (n) { return n !== VERSION; }).map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== self.location.origin) return;
  if (/^\/(api|auth|mcp|authorize|token|register|\.well-known)(\/|$)/.test(u.pathname)) return;
  if (INTERFACE.indexOf(u.pathname) < 0) return;
  e.respondWith(fetch(r).then(function (rep) {
    if (rep.ok) { var copie = rep.clone(); caches.open(VERSION).then(function (c) { c.put(r, copie); }); }
    return rep;
  }).catch(function () { return caches.match(r, { ignoreSearch: true }); }));
});
