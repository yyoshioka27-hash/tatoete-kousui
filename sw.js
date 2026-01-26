// sw.js
// ★ 更新するたびに数字を上げる（tatoete-v7: Workers API素通し版）
const CACHE_NAME = "tatoete-v8";

const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./metaphors.js",
  "./script.js",            // ✅ 追加（実体ファイル名がscript.jsならOK）
  "./shared-metaphors.js",  // ✅ もし存在するならキャッシュ（無くても動く）
  "./detect.js"             // ✅ もし存在するならキャッシュ（無くても動く）
];

// ------------------------------
// utils
// ------------------------------
function isHtmlRequest(req) {
  return req.headers.get("accept")?.includes("text/html");
}

// ✅ ここが本丸：Workers APIはService Workerが触らない（必ずネットに出す）
function isWorkersApi(req) {
  try {
    const url = new URL(req.url);
    return url.hostname.endsWith("workers.dev"); // 例: ...workers.dev
  } catch {
    return false;
  }
}

// ついでに：Open-Meteoなど外部APIも素通し（キャッシュ汚染防止）
function isExternalApi(req) {
  try {
    const url = new URL(req.url);
    // GitHub Pages（同一オリジン）以外は基本キャッシュしない方針
    return url.origin !== self.location.origin;
  } catch {
    return false;
  }
}

// ------------------------------
// install：必要最低限だけキャッシュ
// ------------------------------
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {
      // addAll で1つでも落ちると全部失敗するので、失敗してもアプリは動くようにする
    })
  );
});

// ------------------------------
// activate：古いキャッシュを全削除
// ------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ------------------------------
// fetch 戦略
// ------------------------------
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // ✅ 1) Workers API / 外部API は「完全に素通し」
  // 　→ public / submit / pending / approve / reject が必ずネットに出る
  if (isWorkersApi(req) || isExternalApi(req)) {
    // respondWith しない＝SWが介入しない（通常のfetchに任せる）
    return;
  }

  // ✅ 2) HTMLは常にネットワーク優先（最新を取りに行く）
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

  // ✅ 3) それ以外（同一オリジンの静的ファイル）はキャッシュ優先
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req).then((res) => {
        // 成功した同一オリジンのみキャッシュ
        // （opaqueやエラーは入れない）
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
