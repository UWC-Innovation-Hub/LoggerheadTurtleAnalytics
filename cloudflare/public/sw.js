// ========================================
// UWC Analytics Dashboard — Service Worker
// Cache-first for static assets, network-first for API
// ========================================

var CACHE_NAME = 'uwc-analytics-v1';

// Static assets to pre-cache on install
var PRECACHE_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/login.html',
  '/login.css',
  '/login.js',
  '/manifest.json'
];

// External assets to cache on first use (CDN scripts, fonts, images)
var CDN_HOSTS = [
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'innovationhub.uwc.ac.za',
  'uwc-za.b-cdn.net'
];

// Install — pre-cache shell assets
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(PRECACHE_URLS);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// Activate — clean old caches
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(name) {
          return name !== CACHE_NAME;
        }).map(function(name) {
          return caches.delete(name);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Fetch — strategy depends on request type
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // API calls — always network, never cache (data freshness matters)
  if (url.pathname.startsWith('/api/')) {
    return; // let the browser handle it normally
  }

  // Same-origin static assets — cache-first, network fallback
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        if (cached) {
          // Return cache immediately, update in background (stale-while-revalidate)
          var fetchPromise = fetch(event.request).then(function(response) {
            if (response.ok) {
              var clone = response.clone();
              caches.open(CACHE_NAME).then(function(cache) {
                cache.put(event.request, clone);
              });
            }
            return response;
          }).catch(function() {});
          // Don't wait for the network — return cache now
          return cached;
        }
        // Not in cache — fetch from network and cache it
        return fetch(event.request).then(function(response) {
          if (response.ok) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, clone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // CDN assets (Chart.js, jsPDF, fonts, images) — cache-first
  var isCDN = CDN_HOSTS.some(function(host) {
    return url.hostname === host || url.hostname.endsWith('.' + host);
  });
  if (isCDN) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        return fetch(event.request).then(function(response) {
          if (response.ok) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, clone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // Everything else — network only
});
