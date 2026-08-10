const CACHE_NAME = "rays-taxi-v1";
const APP_SHELL = [
    "./",
    "./index.html",
    "./driver.html",
    "./driver-login.html",
    "./driver-map.html",
    "./style.css",
    "./customer.js",
    "./driver.js",
    "./driver-login.js",
    "./driver-map.js",
    "./firebase.js",
  "./pwa.js",
  "./manifest.webmanifest",
  "./driver-manifest.webmanifest",
  "./pwa-icon-192.png",
    "./pwa-icon-512.png",
    "./taxi-ipsum.png"
];

self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        ))
    );
    self.clients.claim();
});

self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                if (response.ok && new URL(event.request.url).origin === self.location.origin) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                }
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
