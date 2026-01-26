// sw.js
// ★ 更新するたびに数字を上げる（tatoete-v8）
const CACHE_NAME = "tatoete-v8";

const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./metaphors.js",
  "./script.js",
  "./shared-metaphors.js",
  "./detect.js"
];

// ------------------------------
// utils
// ------------------------------
function isHtmlRequest(req) {
  return req.headers.get("accept")?.includes("text/html");
}

// ✅ Workers API（workers.dev）はSWが触らない
function isWorkersApi(req) {
  try {
    const url = new URL(req.url);
    return url.hostname.endsWith("workers.dev");
  } catch {
    return false;
  }
}

// ✅ 外部API（Open-Meteoなど）も触らない
function isExternalApi(req) {
  try {
    const url = new URL(req.url);
    return url.origin !== self.location.origin;
  } catch {
    return false;
  }
}

// ------------------------------
// install
// ------------------------------
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .catch(() => {})
  );
});

// ------------------------------
// activate
// ------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ------------------------------
// fetch
// ------------------------------
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // ✅ 1) Workers / 外部API は完全素通し
  if (isWorkersApi(req) || isExternalApi(req)) return;

  // ✅ 2) HTMLはネット優先
  if (isHtmlRequest(req)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // ✅ 3) 同一オリジン静的ファイルはキャッシュ優先
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});

// # END
