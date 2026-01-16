// ★ 更新するたびに数字を上げる（tatoete-v5: 各時間帯のいいね機能）
const CACHE_NAME = "tatoete-v5";

const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./metaphors.js"
];

// インストール時：必要最低限だけキャッシュ
self.addEventListener("install", (event) => {
  self.skipWaiting(); // すぐ有効化
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// 有効化時：古いキャッシュを全削除
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim(); // すぐ制御
});

// fetch戦略
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // HTMLは常に最新を取りに行く
  if (req.headers.get("accept")?.includes("text/html")) {
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

  // それ以外（manifest等）はキャッシュ優先
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
