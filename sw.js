// sw.js
// ★ 更新するたびに数字を上げる（最小更新: 古い静的アセット回避）
const CACHE_NAME = "tatoete-v11";

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

// Workers API は SW が触らない（必ずネットへ）
function isWorkersApi(req) {
  try {
    const url = new URL(req.url);
    return url.hostname.endsWith("workers.dev");
  } catch {
    return false;
  }
}

// 外部API（Open-Meteo等）も素通し
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
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
});

// ------------------------------
// activate
// ------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
// ------------------------------
// fetch
// ------------------------------
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // 1) Workers / 外部API は完全素通し（SWが介入しない）
  if (isWorkersApi(req) || isExternalApi(req)) return;

  // 2) HTMLはネットワーク優先
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

    // 3) 静的ファイルはネットワーク優先（古いJSを掴まないため）
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});

// # END
