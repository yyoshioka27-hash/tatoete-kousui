const CACHE_NAME = "tatoete-kousui-v1";
const BASE = "/tatoete-kousui";

const ASSETS = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/manifest.webmanifest`,
  `${BASE}/sw.js`,
  `${BASE}/icons/icon-192.png`,
  `${BASE}/icons/icon-512.png`
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // GitHub Pagesの自分のスコープ内だけ扱う
  if (!url.pathname.startsWith(BASE)) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;

      try {
        const res = await fetch(req);
        // 成功したものはキャッシュして次回を速くする
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, res.clone());
        return res;
      } catch (e) {
        // オフライン時のフォールバック（最低限 index を返す）
        const fallback = await caches.match(`${BASE}/index.html`);
        return fallback || new Response("Offline", { status: 503 });
      }
    })()
  );
});
