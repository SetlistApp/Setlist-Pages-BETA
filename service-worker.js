/* Bellafaire Brothers Setlist — offline app-shell service worker.
 *
 * The app is served only from the GitHub Pages sites now (beta:
 * Setlist-Pages-BETA, prod: Setlist-App-PR — see scripts/ship-pages.mjs);
 * the Apps Script project is backend-only, its doGet just redirects here.
 * See web/README.md.
 *
 * Keep SW_VERSION in lockstep with APP_VERSION in app_body_complete.jsx and
 * Code_v*.gs — bump all of them together on every ship.
 */

var SW_VERSION = "2.0.5";
var CACHE = "setlist-shell-" + SW_VERSION;

/* The app shell: the page itself plus the two CDN scripts it pulls today.
 * TODO at host-move time: self-host react / react-dom instead of unpkg so the
 * shell has zero cross-origin dependencies and precaches reliably offline. */
var SHELL = [
  "./",
  "./index.html",
  "https://unpkg.com/react@18/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // Fetch each shell entry individually (not cache.addAll, which is
      // all-or-nothing) so one flaky CDN response can't block install. The
      // navigate handler below still guarantees the page opens offline.
      return Promise.all(SHELL.map(function (url) {
        return fetch(url, { cache: "no-cache" })
          .then(function (res) { if (res && res.ok) return cache.put(url, res); })
          .catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;

  // Never intercept writes or cross-origin API traffic (the future JSON API
  // on script.google.com). Only same-origin GETs are cacheable — this is the
  // no-data-loss guardrail: a save request must always hit the network raw.
  if (req.method !== "GET") return;

  var sameOrigin = new URL(req.url).origin === self.location.origin;

  // config.js carries this site's backend /exec URL (beta vs production) and
  // must never be served stale — network-first, updating the cached copy on
  // success, falling back to cache only when genuinely offline. It is
  // deliberately NOT in SHELL, so install never precaches an old one.
  if (sameOrigin && new URL(req.url).pathname.endsWith("/config.js")) {
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req, { ignoreVary: true, ignoreSearch: true });
      })
    );
    return;
  }

  if (req.mode === "navigate") {
    // Network-first: always fetch the latest HTML from the server so a
    // reload (or closing and reopening the PWA) immediately picks up a new
    // version. Falls back to the cached shell only when genuinely offline.
    // The old stale-while-revalidate strategy served cached HTML instantly
    // but forced multiple close/reopen cycles before an update landed.
    var opts = { ignoreVary: true, ignoreSearch: true };
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok && res.type === "basic") {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put("./index.html", copy); });
        }
        return res;
      }).catch(function () {
        return caches.match("./index.html", opts).then(function (cached) {
          return cached || caches.match("./", opts);
        });
      })
    );
    return;
  }

  // Same-origin static assets (and the whitelisted CDN scripts): cache-first,
  // revalidating in the background so an update lands on the next load.
  if (!sameOrigin && SHELL.indexOf(req.url) === -1) return;

  event.respondWith(
    caches.match(req, { ignoreVary: true }).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
