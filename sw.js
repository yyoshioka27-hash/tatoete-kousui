// sw.js
// ★ 更新するたびに数字を上げる（tatoete-v7: Workers API素通し版）
const CACHE_NAME = "tatoete-v8";

// ✅ キャッシュしたい「同一オリジンの静的ファイル」だけを入れる
// ※ 存在しないファイルが混ざっても install が落ちないように、後で1件ずつ追加する
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./metaphors.js",
  "./script.js",            // ✅ 実体がscript.jsならOK
  "./shared-metaphors.js",  // ✅ 存在するならOK（無くても問題なし）
  "./detect.js"             // ✅ 存在するならOK（無くても問題なし）
];

// ------------------------------
// utils
// ------------------------------
function isHtmlRequest(req) {
  return req.headers.get("accept")?.includes("text/html");
}

// ✅ Workers API は常にネットワーク（SWキャッシュに触れさせない）
function isWorkersApi(req) {
  try {
    const url = new URL(req.url);
    return url.hostname.endsWith("workers.dev"); // 例: ...workers.dev
  } catch {
    return false;
  }
}

// ✅ Open-Meteo 等の外部 API もキャッシュしない（汚染防止）
function isExternal(req) {
  try {
    const url = new URL(req.url);
    return url.origin !== self.location.origin; // 同一オリジン以外
  } catch {
    return false;
  }
}

// ------------------------------
// install：必要最低限だけキャッシュ（1件ずつ入れて失敗しても続行）
// ------------------------------
self.addEventListener("install", (event) => {
  self.skipWaiting();

  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // addAll は「1件でも404があると全滅」なので使わない
      await Promise.all(
        ASSETS.map(async (path) => {
          try {
            const req = new Request(path, { cache: "reload" });
            const res = await fetch(req);
            if (res && res.ok) await cache.put(req, res);
          } catch {
            // 無視（ファイルが無い/ネット不調でもSW自体は動かす）
          }
        })
      );
    })()
  );
});

// ------------------------------
// activate：古いキャッシュを全削除
// ------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// ------------------------------
// fetch 戦略
// ------------------------------
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // ✅ 1) 外部（Workers/Open-Meteo等）は SW が一切介入しない（完全に素通し）
  // → public/submit も天気APIも常に最新
  if (isExternal(req) || isWorkersApi(req)) {
    return; // respondWithしない＝通常のブラウザfetchに任せる
  }

  // ✅ 2) HTML はネットワーク優先（最新を取りに行く）
  if (isHtmlRequest(req)) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const copy = res.clone();
          const cache = await caches.open(CACHE_NAME);
          await cache.put(req, copy);
          return res;
        } catch {
          const cached = await caches.match(req);
          return cached || new Response("offline", { status: 503 });
        }
      })()
    );
    return;
  }

  // ✅ 3) 同一オリジンの静的ファイルはキャッシュ優先
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;

      const res = await fetch(req);
      // 成功したものだけキャッシュ
      if (res && res.ok) {
        const copy = res.clone();
        const cache = await caches.open(CACHE_NAME);
        await cache.put(req, copy);
      }
      return res;
    })()
  );
});

// # END
