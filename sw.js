// ── SERVICE WORKER — Gradation Master 5000 ──────────────────────
// Bump this on every deploy that changes cached content. Old-versioned
// caches get cleaned up automatically on activate.
const CACHE_VERSION = 'gradation-master-v2';

// The app shell — this is a single-file app (all CSS/JS inline in
// index.html), so there's very little to precache. These are fetched and
// cached the moment the service worker installs, so the very first offline
// load (no prior successful visit at all) still works.
const SHELL_ASSETS = [
  './',
  'index.html',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png',
  'icons/icon-180.png',
];

// Third-party origins that are safe to cache-and-reuse offline: fonts and
// the MSAL library. NEVER auth or data endpoints — see the exclusion list
// in the fetch handler below.
const CACHEABLE_CDN_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
];

// Auth and data endpoints — always go straight to the network, never
// served from or written to this cache. The app's own IndexedDB-based
// offline queue (not this service worker) is what makes data entry work
// offline; caching auth/API responses here would risk stale or
// cross-session data.
const NEVER_CACHE_HOSTS = [
  'login.microsoftonline.com',
  'login.live.com',
  'graph.microsoft.com',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(SHELL_ASSETS.map((url) => new Request(url, { cache: 'reload' })))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_VERSION)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never intercept POST (submissions) etc.

  const url = new URL(req.url);

  // Never touch auth/data calls — let them go straight through.
  if (NEVER_CACHE_HOSTS.some((h) => url.hostname === h)) return;

  const isSameOrigin = url.origin === self.location.origin;
  const isCacheableCdn = CACHEABLE_CDN_HOSTS.some((h) => url.hostname === h);
  if (!isSameOrigin && !isCacheableCdn) return; // unrecognized origin — don't intercept

  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(req);
      // Cache-first, refreshing in the background when online (so updates
      // propagate on the *next* load rather than blocking this one).
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        network; // fire-and-forget refresh, don't await it
        return cached;
      }
      const fresh = await network;
      if (fresh) return fresh;
      // Nothing cached and no network — for a navigation request, fall
      // back to the shell itself rather than a browser error page.
      if (req.mode === 'navigate') {
        const shell = await cache.match('index.html');
        if (shell) return shell;
      }
      return new Response('Offline and not yet cached.', { status: 503, statusText: 'Offline' });
    })
  );
});
